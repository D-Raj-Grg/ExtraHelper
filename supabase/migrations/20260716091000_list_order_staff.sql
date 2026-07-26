-- ============================================================================
-- Staff list for the POS "assign staff" picker.
--
-- list_tenant_members can't serve this: it's gated on has_tenant_role(owner,
-- manager), so a waiter gets zero rows AND no error — an empty select with no
-- clue why. It also joins auth.users for emails, which the POS has no business
-- reading.
--
-- So: a narrow reader. Names only, any of the four order roles may call it.
-- Do not widen it — if the team screen needs more, that's list_tenant_members.
-- ============================================================================

create or replace function public.list_order_staff(_tenant uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ut.user_id,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), 'Staff')::text
  from public.user_tenants ut
  left join public.profiles p on p.id = ut.user_id
  where ut.tenant_id = _tenant
    and ut.status = 'active'
    and ut.role in ('owner', 'manager', 'cashier', 'waiter')
    and public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter')
  order by 2;
$$;

revoke execute on function public.list_order_staff(uuid) from anon, public;
grant execute on function public.list_order_staff(uuid) to authenticated;
