-- Account deletion, callable by the account's own owner.
--
-- App Store Guideline 5.1.1(v): an app that lets someone create an account
-- must let them delete it from inside the app. In-app signup ships with the
-- Flutter release that lands alongside this migration, so this is required
-- before the next submission, not a nice-to-have.
--
-- Two things stop a delete, and both are refusals with an explanation rather
-- than a cascade:
--
--   1. **Sole owner of a restaurant.** Deleting would orphan the tenant along
--      with its orders, bills and staff. The user is told to hand ownership
--      over or delete the restaurant first. `user_tenants` cascades from
--      `auth.users`, so without this check the membership would vanish and
--      leave a live restaurant nobody can administer.
--
--   2. **Recorded money.** `cash_movements.created_by` and
--      `supplier_payments.created_by` are `not null ... on delete restrict` on
--      purpose: a cash record must keep the person who made it. The raw FK
--      error is unreadable, so this catches the case first and says what it is.
--      Anyone in this position deletes their account by having the restaurant
--      remove them, which ends their access while the financial record stands.
--
-- Everything else the user owns goes by cascade from `auth.users`: `profiles`,
-- `user_tenants`, `user_prefs`. Actor columns that are nullable
-- (`audit_logs.actor_id`, `orders.waiter_id`, `bills.cashier_id`, the various
-- `approved_by`) are `on delete set null`, so history survives the person.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid       uuid := auth.uid();
  _orphaned  text;
  _money     boolean;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Restaurants where this user is an active owner and no other active owner
  -- exists. Named, because "one of your restaurants" is not actionable.
  select string_agg(t.name, ', ' order by t.name)
    into _orphaned
  from public.user_tenants ut
  join public.tenants t on t.id = ut.tenant_id
  where ut.user_id = _uid
    and ut.role = 'owner'
    and ut.status = 'active'
    and not exists (
      select 1
      from public.user_tenants other
      where other.tenant_id = ut.tenant_id
        and other.user_id <> _uid
        and other.role = 'owner'
        and other.status = 'active'
    );

  if _orphaned is not null then
    raise exception
      'You are the only owner of %. Make someone else an owner, or delete the restaurant, before deleting your account.',
      _orphaned
      using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.cash_movements where created_by = _uid
    union all
    select 1 from public.supplier_payments where created_by = _uid
  ) into _money;

  if _money then
    raise exception
      'Your account is attached to cash records that have to be kept. Ask an owner to remove you from the restaurant — that ends your access straight away.'
      using errcode = 'P0002';
  end if;

  delete from auth.users where id = _uid;
end;
$$;

-- `public` holds EXECUTE by default and revoking from `anon` alone does
-- nothing. Name the full signature: grants do not carry across a new function
-- object.
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
