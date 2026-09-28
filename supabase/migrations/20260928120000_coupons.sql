-- ============================================================================
-- Coupons: campaign codes a guest scans off a flyer or a cashier types.
--
-- Why this migration exists. `coupons` was created in
-- 20260710095939_inventory_customers.sql with `is_active / valid_from /
-- valid_to / usage_limit`. A later `create table if not exists` in
-- 20260713100000 (which used `active / expires_at / max_uses`) was a no-op, and
-- every `apply_coupon` body since read the columns that never existed — so the
-- RPC raised `record "_c" has no field "active"` on its first call. Nobody hit
-- it because nothing could create a coupon. This file:
--
--   * keeps the live column names and adds the campaign rules (minimum order,
--     once per customer, order types, a name for staff);
--   * stamps `discounts.coupon_id` so a redemption is the existing discount row
--     (both clients key the staff-discount slot on `coupon_code is null`, so
--     that column stays populated too);
--   * one validator, `_coupon_lookup`, shared by the POS, the guest surfaces and
--     the mobile app — the three cannot disagree on what "valid" means;
--   * guest orders carry a pending code in `orders.coupon_code`; it is redeemed
--     when the order reaches a bill (builder or `add_order_to_bill`) and quoted
--     only while it still validates, so the gateway never charges less than the
--     bill that is built a moment later;
--   * `coupons` and `discounts` lose their FOR ALL policy: any member could
--     insert a 100% coupon or a discount row straight through PostgREST. Writes
--     go through the definer RPCs below, which check the permission and audit.
--
-- Messages raised here are read verbatim by staff and guests. They avoid the
-- word "percent": the mobile app rewrites any error containing it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
update public.coupons set code = upper(trim(code)) where code <> upper(trim(code));

alter table public.coupons
  add column if not exists name               text,
  add column if not exists min_subtotal_cents integer not null default 0,
  add column if not exists once_per_customer  boolean not null default false,
  add column if not exists order_types        public.order_type[],
  add column if not exists created_by         uuid references auth.users(id) on delete set null,
  add column if not exists updated_at         timestamptz not null default now();

comment on column public.coupons.order_types is 'Null = any order type. Otherwise the coupon applies only to these.';
comment on column public.coupons.min_subtotal_cents is 'Item subtotal (before service, tax, charges) the order must reach.';

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_coupons_updated') then
    create trigger trg_coupons_updated before update on public.coupons
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.coupons drop constraint if exists coupons_value_positive;
alter table public.coupons add constraint coupons_value_positive check (value > 0);
alter table public.coupons drop constraint if exists coupons_percent_cap;
alter table public.coupons add constraint coupons_percent_cap check (type <> 'percent' or value <= 100);
alter table public.coupons drop constraint if exists coupons_code_shape;
alter table public.coupons add constraint coupons_code_shape check (code ~ '^[A-Z0-9-]{4,24}$');
alter table public.coupons drop constraint if exists coupons_min_subtotal_nonneg;
alter table public.coupons add constraint coupons_min_subtotal_nonneg check (min_subtotal_cents >= 0);
alter table public.coupons drop constraint if exists coupons_window;
alter table public.coupons add constraint coupons_window
  check (valid_to is null or valid_from is null or valid_to > valid_from);

alter table public.discounts
  add column if not exists coupon_id uuid references public.coupons(id) on delete restrict;
create index if not exists idx_discounts_coupon on public.discounts(coupon_id) where coupon_id is not null;
-- One coupon per bill, enforced where a race cannot slip past it.
create unique index if not exists uq_discounts_one_coupon_per_bill
  on public.discounts(bill_id) where coupon_id is not null;

-- A guest's pending code: stamped at placement, redeemed when the order reaches
-- a bill, then cleared. Staff orders never use it.
alter table public.orders add column if not exists coupon_code text;

-- ---------------------------------------------------------------------------
-- 2. Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, grp, label, sort) values
  ('coupons.view',   'Coupons', 'See coupons and how often they were used', 230),
  ('coupons.manage', 'Coupons', 'Create, edit and delete coupons', 231)
on conflict (key) do nothing;

-- Owner and manager already resolve to "every key" in default_role_permissions;
-- system roles carry explicit rows, so backfill those two.
insert into public.role_permissions (role_id, permission_key)
select r.id, k.key
from public.roles r
cross join lateral public.default_role_permissions(r.base_role) k(key)
where r.is_system and k.key like 'coupons.%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS: read-only for members; every write goes through an RPC below.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_all on public.coupons;
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons
  for select to authenticated
  using (
    (tenant_id in (select public.current_tenant_ids())
     and public.has_permission(tenant_id, 'coupons.view'))
    or public.is_platform_admin()
  );

drop policy if exists tenant_all on public.discounts;
drop policy if exists discounts_select on public.discounts;
create policy discounts_select on public.discounts
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

revoke insert, update, delete, truncate, references, trigger on public.coupons from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.discounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (no auth guard → not callable by clients)
-- ---------------------------------------------------------------------------

-- The coupon's own contribution, capped at what the bill can absorb. The
-- arithmetic is the bill-level branch of bill_discount_total, character for
-- character: numeric round() (half away from zero), never ::integer.
create or replace function public._coupon_discount_cents(
  _type public.discount_type, _value numeric, _subtotal integer, _gross integer
) returns integer
language sql immutable set search_path = public
as $$
  select least(
    case when _type = 'percent' then round(_subtotal * _value / 100.0)
         else round(_value * 100) end,
    _gross
  )::integer;
$$;

-- Find a coupon and check every rule against this order. Raises a sentence the
-- caller can show; returns the row when it may be used.
create or replace function public._coupon_lookup(
  _tenant uuid, _code text, _subtotal_cents integer, _order_type public.order_type, _customer uuid
) returns public.coupons
language plpgsql stable set search_path = public
as $$
declare _c public.coupons; _norm text;
begin
  _norm := upper(trim(coalesce(_code, '')));
  if _norm = '' then raise exception 'Enter a coupon code' using errcode = '22023'; end if;

  select * into _c from public.coupons where tenant_id = _tenant and code = _norm limit 1;
  if _c.id is null then raise exception 'That coupon code isn''t valid' using errcode = '22023'; end if;
  if not _c.is_active then raise exception 'This coupon is paused' using errcode = '22023'; end if;
  if _c.valid_from is not null and _c.valid_from > now() then
    raise exception 'This coupon isn''t valid yet' using errcode = '22023';
  end if;
  if _c.valid_to is not null and _c.valid_to <= now() then
    raise exception 'This coupon has expired' using errcode = '22023';
  end if;
  if _c.usage_limit is not null and _c.used_count >= _c.usage_limit then
    raise exception 'This coupon has been used up' using errcode = '22023';
  end if;
  if _c.order_types is not null and not (_order_type = any (_c.order_types)) then
    raise exception 'This coupon isn''t valid for % orders',
      case _order_type when 'dine_in' then 'dine-in' when 'pickup' then 'takeaway'
                       when 'delivery' then 'delivery' else 'QR' end
      using errcode = '22023';
  end if;
  if _subtotal_cents < _c.min_subtotal_cents then
    raise exception 'Minimum order for this coupon is not reached' using errcode = '22023';
  end if;
  -- Joins through the order's customer, so a customer attached after the
  -- redemption is still caught on their next visit.
  if _c.once_per_customer and _customer is not null and exists (
    select 1 from public.discounts d
    join public.orders o on o.bill_id = d.bill_id
    where d.coupon_id = _c.id and o.customer_id = _customer
  ) then
    raise exception 'This customer has already used this coupon' using errcode = '22023';
  end if;
  return _c;
end $$;

-- Put a looked-up coupon on a bill. Strict callers (the POS) want "already on
-- this bill" raised; the guest paths pass false and take a quiet no.
create or replace function public._redeem_coupon_on_bill(_bill uuid, _coupon_id uuid, _strict boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _c public.coupons; _bumped integer;
begin
  select tenant_id into _tenant from public.bills where id = _bill;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;

  if exists (select 1 from public.discounts where bill_id = _bill and coupon_id is not null) then
    if _strict then raise exception 'A coupon is already on this bill' using errcode = '22023'; end if;
    return false;
  end if;

  -- Row lock + bump-if-under-limit in one statement: two cashiers redeeming
  -- the last use at once cannot both succeed.
  update public.coupons set used_count = used_count + 1
  where id = _coupon_id and tenant_id = _tenant
    and (usage_limit is null or used_count < usage_limit)
  returning * into _c;
  get diagnostics _bumped = row_count;
  if _bumped = 0 then
    if _strict then raise exception 'This coupon has been used up' using errcode = '22023'; end if;
    return false;
  end if;

  insert into public.discounts (tenant_id, bill_id, type, value, coupon_id, coupon_code, reason, approved_by)
  values (_tenant, _bill, _c.type, _c.value, _c.id, _c.code, 'coupon', auth.uid());

  perform public.recompute_bill(_bill);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill,
          jsonb_build_object('coupon', _c.code, 'type', _c.type, 'value', _c.value));
  return true;
end $$;

-- Try a stamped guest code once the order sits on a bill. Never raises: the
-- bill stands either way, and a code that stopped validating in the meantime
-- is written down as lapsed rather than blocking the guest's payment.
create or replace function public._settle_pending_coupon(_order_id uuid, _bill uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _code text; _otype public.order_type; _cust uuid; _subtotal integer; _c public.coupons;
begin
  select tenant_id, coupon_code, order_type, customer_id into _tenant, _code, _otype, _cust
  from public.orders where id = _order_id;
  if _code is null then return; end if;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0) into _subtotal
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill and oi.is_void = false;

  begin
    _c := public._coupon_lookup(_tenant, _code, _subtotal, _otype, _cust);
    if not public._redeem_coupon_on_bill(_bill, _c.id, false) then
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
      values (_tenant, auth.uid(), 'coupon_lapsed', 'bill', _bill,
              jsonb_build_object('coupon', _code, 'reason', 'bill already has a coupon'));
    end if;
  exception when others then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'coupon_lapsed', 'bill', _bill,
            jsonb_build_object('coupon', _code, 'reason', sqlerrm));
  end;

  update public.orders set coupon_code = null where id = _order_id;
end $$;

revoke execute on function public._coupon_discount_cents(public.discount_type, numeric, integer, integer) from public, anon, authenticated;
revoke execute on function public._coupon_lookup(uuid, text, integer, public.order_type, uuid) from public, anon, authenticated;
revoke execute on function public._redeem_coupon_on_bill(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._settle_pending_coupon(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Staff RPCs
-- ---------------------------------------------------------------------------

-- Same signature as before, so every client — the mobile app included — keeps
-- calling it and simply starts to work.
create or replace function public.apply_coupon(_bill_id uuid, _code text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _subtotal integer; _otype public.order_type;
        _cust uuid; _c public.coupons; _total integer;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status in ('paid', 'void') then raise exception 'bill already settled' using errcode = '22023'; end if;

  -- The live subtotal, as recompute_bill sees it — not bills.subtotal_cents,
  -- which is only current after a recompute.
  select coalesce(sum(oi.unit_price_cents * oi.qty), 0) into _subtotal
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;
  select o.order_type into _otype from public.orders o where o.bill_id = _bill_id order by o.created_at limit 1;
  select o.customer_id into _cust from public.orders o
  where o.bill_id = _bill_id and o.customer_id is not null order by o.created_at limit 1;

  _c := public._coupon_lookup(_tenant, _code, _subtotal, coalesce(_otype, 'dine_in'), _cust);
  perform public._redeem_coupon_on_bill(_bill_id, _c.id, true);

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- Take a coupon back off (a mistyped code, or the guest changed their mind).
-- The use is handed back to the campaign.
create or replace function public.remove_coupon(_bill_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _coupon_id uuid; _code text; _total integer;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status in ('paid', 'void') then raise exception 'bill already settled' using errcode = '22023'; end if;

  delete from public.discounts
  where bill_id = _bill_id and coupon_id is not null
  returning coupon_id, coupon_code into _coupon_id, _code;

  if _coupon_id is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = _coupon_id;
    perform public.recompute_bill(_bill_id);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'discount_removed', 'bill', _bill_id, jsonb_build_object('coupon', _code));
  end if;

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- Create or edit a campaign. A blank code is generated. The code is fixed once
-- anyone has redeemed it — the printed flyers carry it.
create or replace function public.upsert_coupon(
  _tenant uuid, _id uuid, _code text, _name text, _type public.discount_type, _value numeric,
  _is_active boolean, _valid_from timestamptz, _valid_to timestamptz, _usage_limit integer,
  _min_subtotal_cents integer, _once_per_customer boolean, _order_types public.order_type[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare _norm text; _existing public.coupons; _out uuid; _redeemed boolean := false; _tries integer := 0;
begin
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _value is null or _value <= 0 then raise exception 'The discount must be above zero' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then raise exception 'A discount can''t be more than 100%%' using errcode = '22023'; end if;
  if coalesce(_min_subtotal_cents, 0) < 0 then raise exception 'Minimum order can''t be negative' using errcode = '22023'; end if;
  if _usage_limit is not null and _usage_limit < 1 then raise exception 'Usage limit must be at least 1' using errcode = '22023'; end if;
  if _valid_from is not null and _valid_to is not null and _valid_to <= _valid_from then
    raise exception 'The coupon must end after it starts' using errcode = '22023';
  end if;
  if _order_types is not null and cardinality(_order_types) = 0 then _order_types := null; end if;

  _norm := upper(trim(coalesce(_code, '')));
  if _norm <> '' and _norm !~ '^[A-Z0-9-]{4,24}$' then
    raise exception 'Codes are 4 to 24 letters, digits or dashes' using errcode = '22023';
  end if;

  if _id is not null then
    select * into _existing from public.coupons where id = _id and tenant_id = _tenant;
    if _existing.id is null then raise exception 'coupon not found' using errcode = 'P0002'; end if;
    _redeemed := exists (select 1 from public.discounts where coupon_id = _id);
    if _redeemed and _norm <> '' and _norm <> _existing.code then
      raise exception 'This code has been redeemed; the printed flyers carry it, so it can''t change' using errcode = '22023';
    end if;
    if _norm = '' then _norm := _existing.code; end if;

    update public.coupons
    set code = _norm, name = nullif(trim(_name), ''), type = _type, value = _value,
        is_active = coalesce(_is_active, true), valid_from = _valid_from, valid_to = _valid_to,
        usage_limit = _usage_limit, min_subtotal_cents = coalesce(_min_subtotal_cents, 0),
        once_per_customer = coalesce(_once_per_customer, false), order_types = _order_types
    where id = _id;
    _out := _id;
  else
    loop
      _tries := _tries + 1;
      if _norm = '' or _tries > 1 then
        -- Core functions only: gen_random_bytes lives in the extensions schema,
        -- out of reach of search_path = public. trunc() keeps "10.00" out of it.
        _norm := 'SAVE' || trunc(_value)::text || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
      end if;
      begin
        insert into public.coupons (tenant_id, code, name, type, value, is_active, valid_from, valid_to,
                                    usage_limit, min_subtotal_cents, once_per_customer, order_types, created_by)
        values (_tenant, _norm, nullif(trim(_name), ''), _type, _value, coalesce(_is_active, true), _valid_from, _valid_to,
                _usage_limit, coalesce(_min_subtotal_cents, 0), coalesce(_once_per_customer, false), _order_types, auth.uid())
        returning id into _out;
        exit;
      exception when unique_violation then
        if _tries = 1 and trim(coalesce(_code, '')) <> '' then
          raise exception 'A coupon with this code already exists' using errcode = '23505';
        end if;
        if _tries >= 5 then raise; end if;
      end;
    end loop;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'coupon_saved', 'coupon', _out,
          jsonb_build_object('code', _norm, 'type', _type, 'value', _value, 'active', coalesce(_is_active, true),
                             'valid_from', _valid_from, 'valid_to', _valid_to, 'usage_limit', _usage_limit,
                             'min_subtotal_cents', coalesce(_min_subtotal_cents, 0),
                             'once_per_customer', coalesce(_once_per_customer, false), 'order_types', _order_types));
  return _out;
end $$;

-- Only a coupon nobody has used can go; a used one is paused instead, so the
-- bills that carry it keep pointing at something.
create or replace function public.delete_coupon(_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _code text;
begin
  select tenant_id, code into _tenant, _code from public.coupons where id = _id;
  if _tenant is null then raise exception 'coupon not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if exists (select 1 from public.discounts where coupon_id = _id) then
    raise exception 'This coupon has been used on a bill; pause it instead of deleting it' using errcode = '22023';
  end if;
  delete from public.coupons where id = _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'coupon_deleted', 'coupon', _id, jsonb_build_object('code', _code));
end $$;

-- The admin list: every campaign with what it has done so far.
create or replace function public.list_coupons(_tenant uuid)
returns table (
  id uuid, code text, name text, type public.discount_type, value numeric, is_active boolean,
  valid_from timestamptz, valid_to timestamptz, usage_limit integer, used_count integer,
  min_subtotal_cents integer, once_per_customer boolean, order_types public.order_type[],
  created_at timestamptz, redemptions bigint, discount_given_cents bigint, last_redeemed_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.code, c.name, c.type, c.value, c.is_active, c.valid_from, c.valid_to, c.usage_limit, c.used_count,
         c.min_subtotal_cents, c.once_per_customer, c.order_types, c.created_at,
         count(d.id) as redemptions,
         coalesce(sum(public._coupon_discount_cents(d.type, d.value, b.subtotal_cents, b.subtotal_cents)), 0)::bigint as discount_given_cents,
         max(d.created_at) as last_redeemed_at
  from public.coupons c
  left join public.discounts d on d.coupon_id = c.id
  left join public.bills b on b.id = d.bill_id
  where c.tenant_id = _tenant and public.has_permission(_tenant, 'coupons.view')
  group by c.id
  order by c.is_active desc, c.created_at desc;
$$;

revoke execute on function public.remove_coupon(uuid) from public, anon;
revoke execute on function public.upsert_coupon(uuid, uuid, text, text, public.discount_type, numeric, boolean, timestamptz, timestamptz, integer, integer, boolean, public.order_type[]) from public, anon;
revoke execute on function public.delete_coupon(uuid) from public, anon;
revoke execute on function public.list_coupons(uuid) from public, anon;
grant execute on function public.remove_coupon(uuid) to authenticated;
grant execute on function public.upsert_coupon(uuid, uuid, text, text, public.discount_type, numeric, boolean, timestamptz, timestamptz, integer, integer, boolean, public.order_type[]) to authenticated;
grant execute on function public.delete_coupon(uuid) to authenticated;
grant execute on function public.list_coupons(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Guest path
-- ---------------------------------------------------------------------------

-- Check a code against the cart before ordering, so the guest sees the deal.
-- Returns {error} rather than raising: a wrong code is an answer, not a fault.
create or replace function public.public_coupon_preview(
  _slug text, _token uuid, _code text, _subtotal_cents integer, _order_type public.order_type
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare _tenant uuid; _c public.coupons; _disc integer;
begin
  if _token is not null then
    select tenant_id into _tenant from public.restaurant_tables where qr_token = _token;
  elsif _slug is not null then
    select id into _tenant from public.tenants where slug = _slug and status <> 'suspended';
  end if;
  if _tenant is null then return jsonb_build_object('error', 'That coupon code isn''t valid'); end if;

  begin
    _c := public._coupon_lookup(_tenant, _code, coalesce(_subtotal_cents, 0), _order_type, null);
  exception when others then
    return jsonb_build_object('error', sqlerrm);
  end;
  _disc := public._coupon_discount_cents(_c.type, _c.value, coalesce(_subtotal_cents, 0), coalesce(_subtotal_cents, 0));
  return jsonb_build_object(
    'code', _c.code, 'name', _c.name, 'type', _c.type, 'value', _c.value,
    'discount_cents', _disc, 'min_subtotal_cents', _c.min_subtotal_cents
  );
end $$;

revoke execute on function public.public_coupon_preview(text, uuid, text, integer, public.order_type) from public;
grant execute on function public.public_coupon_preview(text, uuid, text, integer, public.order_type) to anon, authenticated;

-- place_qr_order gains `_coupon`. New arity → drop + create, and no 2-arg
-- wrapper: with the default, PostgREST could not choose between the two.
drop function if exists public.place_qr_order(uuid, jsonb);
create function public.place_qr_order(_token uuid, _items jsonb, _coupon text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _branch uuid;
  _table  uuid;
  _order  uuid;
  _line   jsonb;
  _item   record;
  _var    uuid;
  _v      record;
  _price  integer;
  _label  text;
  _count  integer := 0;
  _recent integer;
  _auto   boolean;
  _subtotal integer := 0;
  _c      public.coupons;
  _max_qty  constant integer := 20;   -- per line
  _max_lines constant integer := 40;  -- per order
begin
  select t.tenant_id, t.branch_id, t.id into _tenant, _branch, _table
  from public.restaurant_tables t where t.qr_token = _token;
  if _tenant is null then
    raise exception 'invalid table code' using errcode = 'P0002';
  end if;
  if _items is null or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode = '22023';
  end if;
  if jsonb_array_length(_items) > _max_lines then
    raise exception 'too many items in one order' using errcode = '22023';
  end if;

  -- Rate limit: at most 3 QR orders per table in a 30s window.
  select count(*) into _recent
  from public.orders
  where table_id = _table and order_type = 'qr'
    and created_at > now() - interval '30 seconds';
  if _recent >= 3 then
    raise exception 'Too many orders — please wait a moment before ordering again'
      using errcode = '53400';
  end if;

  -- One coupon per table visit: a second round on the same table cannot carry
  -- another, whether the first is still pending or already on the bill.
  if coalesce(trim(_coupon), '') <> '' and exists (
    select 1 from public.orders o
    left join public.discounts d on d.bill_id = o.bill_id and d.coupon_id is not null
    where o.table_id = _table and o.order_type = 'qr'
      and o.status not in ('closed', 'cancelled')
      and (o.coupon_code is not null or d.id is not null)
  ) then
    raise exception 'A coupon is already on this table''s order' using errcode = '22023';
  end if;

  insert into public.orders (tenant_id, branch_id, table_id, order_type, status, placed_at)
  values (_tenant, _branch, _table, 'qr', 'placed', now())
  returning id into _order;

  for _line in select * from jsonb_array_elements(_items)
  loop
    select id, name, base_price_cents into _item
    from public.menu_items
    where id = nullif(_line->>'item_id', '')::uuid and tenant_id = _tenant
      and is_active and not is_86;
    if _item.id is not null then
      _price := _item.base_price_cents;
      _label := _item.name;
      _var   := nullif(_line->>'variant_id', '')::uuid;

      -- A variant that isn't this dish's own is a mispriced line, not a
      -- typo to absorb: reject the order rather than charge the guest the
      -- base price for the size they didn't pick.
      if _var is not null then
        select name, price_delta_cents into _v
        from public.item_variants
        where id = _var and item_id = _item.id and tenant_id = _tenant;
        if not found then
          raise exception 'that option is no longer available' using errcode = '22023';
        end if;
        _price := _price + _v.price_delta_cents;
        _label := _item.name || ' (' || _v.name || ')';
      end if;

      insert into public.order_items (tenant_id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _var, _label,
              least(_max_qty, greatest(1, coalesce((_line->>'qty')::int, 1))),
              _price, 'placed');
      _subtotal := _subtotal + _price * least(_max_qty, greatest(1, coalesce((_line->>'qty')::int, 1)));
      _count := _count + 1;
    end if;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
  end if;

  -- A bad code fails the placement with a sentence the guest can act on; a
  -- good one is stamped and redeemed when the table is billed. No customer is
  -- known here, so once-per-customer cannot apply to a QR guest.
  if coalesce(trim(_coupon), '') <> '' then
    _c := public._coupon_lookup(_tenant, _coupon, _subtotal, 'qr', null);
    update public.orders set coupon_code = _c.code where id = _order;
  end if;

  update public.restaurant_tables set state = 'occupied'
  where id = _table and state = 'free';

  -- A tenant with no settings row is treated as auto-fire: a guest order the
  -- kitchen never sees is the worse failure of the two.
  select coalesce(s.qr_auto_fire, true) into _auto
  from public.tenant_settings s where s.tenant_id = _tenant;
  if coalesce(_auto, true) then
    -- Firing must not be able to reject the guest's order (see 20260814150000).
    begin
      perform public.fire_order_kots(_order, _tenant);
    exception when others then
      null;
    end;
  end if;

  return _order;
end $$;

revoke execute on function public.place_qr_order(uuid, jsonb, text) from public;
grant execute on function public.place_qr_order(uuid, jsonb, text) to anon, authenticated;

-- place_online_order gains `_coupon` the same way. The customer is known at
-- placement here (find-or-create by phone), so once-per-customer applies.
drop function if exists public.place_online_order(text, jsonb, text, text, text, jsonb);
create function public.place_online_order(
  _slug text, _items jsonb, _fulfillment text,
  _name text, _phone text, _address jsonb, _coupon text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _cust uuid; _order uuid; _online uuid;
  _fee_units numeric; _fee_cents integer := 0;
  _line jsonb; _item record; _count integer := 0;
  _ftype public.order_type; _subtotal integer := 0; _qty integer; _c public.coupons;
begin
  select id into _tenant from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then raise exception 'store not found' using errcode='P0002'; end if;
  if _fulfillment not in ('delivery','pickup') then
    raise exception 'invalid fulfillment' using errcode='22023';
  end if;
  if _items is null or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode='22023';
  end if;
  _ftype := _fulfillment::public.order_type;

  select coalesce((order_type_fees->>_fulfillment)::numeric, 0) into _fee_units
  from public.tenant_settings where tenant_id = _tenant;
  _fee_cents := round(coalesce(_fee_units,0) * 100);

  -- Find-or-create by normalised phone: a returning guest is one customer,
  -- not a new row per order.
  _cust := public.customer_for_phone(_tenant, _name, _phone);

  insert into public.orders (tenant_id, order_type, status, customer_id, placed_at)
  values (_tenant, _ftype, 'placed', _cust, now()) returning id into _order;

  for _line in select * from jsonb_array_elements(_items) loop
    select id, name, base_price_cents into _item from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant and is_active and not is_86;
    if _item.id is not null then
      _qty := greatest(1, least(99, coalesce((_line->>'qty')::int,1)));
      insert into public.order_items (tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _item.name, _qty, _item.base_price_cents, 'placed');
      _subtotal := _subtotal + _item.base_price_cents * _qty;
      _count := _count + 1;
    end if;
  end loop;
  if _count = 0 then raise exception 'no valid items' using errcode='22023'; end if;

  if coalesce(trim(_coupon), '') <> '' then
    _c := public._coupon_lookup(_tenant, _coupon, _subtotal, _ftype, _cust);
    update public.orders set coupon_code = _c.code where id = _order;
  end if;

  insert into public.online_orders (tenant_id, order_id, customer_id, channel, fulfillment, address, fee_cents, status)
  values (_tenant, _order, _cust, 'web', _ftype, _address, _fee_cents, 'received')
  returning id into _online;

  return _online;
end $$;

revoke execute on function public.place_online_order(text, jsonb, text, text, text, jsonb, text) from public;
grant execute on function public.place_online_order(text, jsonb, text, text, text, jsonb, text) to anon, authenticated;

-- The bill builder redeems a pending code once the bill exists. Same arity;
-- body otherwise the 20260713131637 version.
create or replace function public._build_bill_for_order(_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _branch uuid; _table uuid; _otype public.order_type;
  _existing uuid; _status public.order_status; _bill uuid;
  _subtotal integer := 0; _service_pct numeric := 0; _packaging numeric := 0;
  _tax_rules jsonb := '[]'; _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0;
begin
  select tenant_id, branch_id, table_id, order_type, bill_id, status
    into _tenant, _branch, _table, _otype, _existing, _status
  from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if _existing is not null then return _existing; end if;
  if _status in ('draft','cancelled') then
    raise exception 'order must be fired before billing' using errcode = '22023';
  end if;

  select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
  from public.order_items where order_id = _order_id and is_void = false;
  select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;
  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then _packaging_cents := round(coalesce(_packaging, 0) * 100); end if;
  select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r where coalesce((r->>'inclusive')::boolean, false) = false;

  insert into public.bills (tenant_id, branch_id, table_id, status, subtotal_cents, tax_cents,
                            service_charge_cents, discount_cents, total_cents)
  values (_tenant, _branch, _table, 'open', _subtotal, _tax_cents, _service_cents + _packaging_cents,
          0, _subtotal + _service_cents + _packaging_cents + _tax_cents)
  returning id into _bill;
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description, qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents, 0, oi.unit_price_cents * oi.qty
  from public.order_items oi where oi.order_id = _order_id and oi.is_void = false;
  update public.orders set status = 'billed', bill_id = _bill where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table;
  end if;

  perform public._settle_pending_coupon(_order_id, _bill);
  return _bill;
end $function$;

-- Merging a later round onto a bill honours the round's pending code — or
-- writes it down as lapsed when the bill already carries one.
create or replace function public.add_order_to_bill(_bill_id uuid, _order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _btenant uuid; _obill uuid; _ostatus public.order_status; _table uuid;
begin
  select tenant_id into _btenant from public.bills where id = _bill_id;
  if _btenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  select tenant_id, bill_id, status, table_id into _tenant, _obill, _ostatus, _table
    from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if _tenant <> _btenant then raise exception 'bill and order belong to different tenants' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _obill is not null and _obill <> _bill_id then
    raise exception 'order already belongs to another bill' using errcode = '22023';
  end if;
  if _ostatus in ('draft','cancelled') then
    raise exception 'order must be fired before billing' using errcode = '22023';
  end if;

  update public.orders set bill_id = _bill_id, status = 'billed' where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table and tenant_id = _tenant;
  end if;
  perform public._settle_pending_coupon(_order_id, _bill_id);
  perform public.recompute_bill(_bill_id);
  return _bill_id;
end $function$;

-- The guest quote subtracts a pending code only while it still validates. The
-- gateway is charged this figure before the bill is built, so quoting a code
-- that would lapse a moment later would leave the bill part-paid.
create or replace function public.public_bill_quote(_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _bill uuid; _otype public.order_type; _status public.order_status;
  _total integer; _paid integer := 0; _currency text; _gateway text;
  _subtotal integer := 0; _service_pct numeric := 0; _packaging numeric := 0;
  _tax_rules jsonb := '[]'; _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0;
  _gross integer := 0; _disc integer := 0; _code text; _cust uuid; _c public.coupons;
begin
  select tenant_id, bill_id, order_type, status, coupon_code, customer_id
    into _tenant, _bill, _otype, _status, _code, _cust
  from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  select currency, payment_gateway into _currency, _gateway from public.tenant_settings where tenant_id = _tenant;

  if _bill is not null then
    select total_cents into _total from public.bills where id = _bill;
    select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill and status = 'completed';
  else
    if _status in ('draft','cancelled') then
      _total := 0;
    else
      select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
      from public.order_items where order_id = _order_id and is_void = false;
      select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
      from public.tenant_settings where tenant_id = _tenant;
      _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
      if _otype in ('pickup', 'delivery') then _packaging_cents := round(coalesce(_packaging, 0) * 100); end if;
      select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
      from jsonb_array_elements(coalesce(_tax_rules, '[]')) r where coalesce((r->>'inclusive')::boolean, false) = false;
      _gross := _subtotal + _service_cents + _packaging_cents + _tax_cents;
      if _code is not null then
        begin
          _c := public._coupon_lookup(_tenant, _code, _subtotal, _otype, _cust);
          _disc := public._coupon_discount_cents(_c.type, _c.value, _subtotal, _gross);
        exception when others then
          _disc := 0;
        end;
      end if;
      _total := greatest(_gross - _disc, 0);
    end if;
  end if;

  return jsonb_build_object(
    'bill_id', _bill, 'total', _total, 'paid', _paid, 'due', greatest(0, _total - _paid),
    'currency', coalesce(_currency, 'USD'), 'gateway', coalesce(_gateway, 'sandbox'), 'tenant_id', _tenant
  );
end $function$;
