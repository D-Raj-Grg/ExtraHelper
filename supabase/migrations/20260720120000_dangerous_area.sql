-- ============================================================================
-- Dangerous Area: Reset / Transfer Ownership / Delete (soft, 7-day grace).
-- Owner-only RPCs (security definer, in-body has_tenant_role check), grants
-- naming full signatures. Tenant isolation preserved throughout.
-- ============================================================================

-- 1. Soft-delete marker. Nullable = not scheduled. Tenant stays fully usable
--    during the grace window so the owner can cancel; a daily cron purges after.
alter table public.tenants
  add column if not exists deletion_scheduled_at timestamptz;

-- 2. Give the resource-usage card denominators. Plan `limits` already carries
--    branches/staff; add tables/menu_items/customers per tier. Trial is treated
--    as unlimited in the UI regardless of these.
update public.plans set limits = limits || '{"tables":10,"menu_items":100,"customers":500}'::jsonb   where code = 'starter';
update public.plans set limits = limits || '{"tables":50,"menu_items":1000,"customers":5000}'::jsonb  where code = 'pro';
update public.plans set limits = limits || '{"tables":500,"menu_items":10000,"customers":100000}'::jsonb where code = 'enterprise';

-- ============================================================================
-- 3. reset_tenant(_tenant, _domains): selectively wipe operational data.
--    _domains ⊆ the 11 keys, or {'everything'} to expand to all. Keeps the
--    tenant, tenant_settings, branches, roles, and the owner membership(s).
--    Cross-domain FKs are cascade/set-null (verified), so child→parent order
--    within each domain is sufficient. The stock-deduct trigger is AFTER UPDATE
--    on order_items, so deletes here don't fire it.
-- ============================================================================
create or replace function public.reset_tenant(_tenant uuid, _domains text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _all boolean := 'everything' = any(_domains);
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _domains is null or array_length(_domains, 1) is null then
    raise exception 'select at least one thing to reset' using errcode = '22023';
  end if;

  -- Orders (KOT tickets + line items + modifiers)
  if _all or 'orders' = any(_domains) then
    delete from public.order_item_modifiers where tenant_id = _tenant;
    delete from public.order_items          where tenant_id = _tenant;
    delete from public.kot_items            where tenant_id = _tenant;
    delete from public.kots                 where tenant_id = _tenant;
    delete from public.orders               where tenant_id = _tenant;
  end if;

  -- Finance (bills, payments, refunds, cash sessions)
  if _all or 'finance' = any(_domains) then
    delete from public.refunds       where tenant_id = _tenant;
    delete from public.payments      where tenant_id = _tenant;
    delete from public.bill_items    where tenant_id = _tenant;
    delete from public.bills         where tenant_id = _tenant;
    delete from public.cash_sessions where tenant_id = _tenant;
  end if;

  -- Customers (+ loyalty + feedback)
  if _all or 'customers' = any(_domains) then
    delete from public.loyalty_transactions where tenant_id = _tenant;
    delete from public.loyalty_accounts     where tenant_id = _tenant;
    delete from public.feedback             where tenant_id = _tenant;
    delete from public.customers            where tenant_id = _tenant;
  end if;

  -- Website (online orders + delivery)
  if _all or 'website' = any(_domains) then
    delete from public.delivery_tracking where tenant_id = _tenant;
    delete from public.online_orders     where tenant_id = _tenant;
  end if;

  -- Menu (catalog; recipes cascade from menu_items)
  if _all or 'menu' = any(_domains) then
    delete from public.item_station_routes where tenant_id = _tenant;
    delete from public.item_availability   where tenant_id = _tenant;
    delete from public.item_variants       where tenant_id = _tenant;
    delete from public.item_modifiers      where tenant_id = _tenant;
    delete from public.menu_item_prices    where tenant_id = _tenant;
    delete from public.menu_schedules      where tenant_id = _tenant;
    delete from public.recipes             where tenant_id = _tenant;
    delete from public.menu_items          where tenant_id = _tenant;
    delete from public.menu_categories     where tenant_id = _tenant;
    delete from public.menus               where tenant_id = _tenant;
    delete from public.modifiers           where tenant_id = _tenant;
    delete from public.combos              where tenant_id = _tenant;
  end if;

  -- Inventory (stock + counts + wastage; recipes/stock_movements cascade)
  if _all or 'inventory' = any(_domains) then
    delete from public.stock_count_items where tenant_id = _tenant;
    delete from public.stock_counts      where tenant_id = _tenant;
    delete from public.wastage           where tenant_id = _tenant;
    delete from public.stock_movements   where tenant_id = _tenant;
    delete from public.inventory_items   where tenant_id = _tenant;
  end if;

  -- Suppliers (+ purchase orders)
  if _all or 'suppliers' = any(_domains) then
    delete from public.po_items         where tenant_id = _tenant;
    delete from public.purchase_orders  where tenant_id = _tenant;
    delete from public.suppliers        where tenant_id = _tenant;
  end if;

  -- Tables (+ the bookings that sit on them)
  if _all or 'tables' = any(_domains) then
    delete from public.reservations      where tenant_id = _tenant;
    delete from public.restaurant_tables where tenant_id = _tenant;
  end if;

  -- Space (floors)
  if _all or 'space' = any(_domains) then
    delete from public.floors where tenant_id = _tenant;
  end if;

  -- Staff (never the owner). Removes members, invites, shifts, join codes.
  if _all or 'staff' = any(_domains) then
    delete from public.staff_shifts     where tenant_id = _tenant;
    delete from public.staff_invites    where tenant_id = _tenant;
    delete from public.tenant_join_codes where tenant_id = _tenant;
    delete from public.user_tenants     where tenant_id = _tenant and role <> 'owner';
  end if;

  -- Activity (audit trail)
  if _all or 'activity' = any(_domains) then
    delete from public.audit_logs where tenant_id = _tenant;
  end if;
end $$;

revoke execute on function public.reset_tenant(uuid, text[]) from public, anon;
grant  execute on function public.reset_tenant(uuid, text[]) to authenticated;

-- ============================================================================
-- 4. transfer_tenant_ownership(_tenant, _to_user): hand ownership to an active
--    member. Caller demotes to manager. Single-owner invariant preserved.
-- ============================================================================
create or replace function public.transfer_tenant_ownership(_tenant uuid, _to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _caller       uuid := auth.uid();
  _owner_role   uuid;
  _manager_role uuid;
  _target_status text;
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _to_user is null or _to_user = _caller then
    raise exception 'choose a different member' using errcode = '22023';
  end if;

  select status into _target_status
  from public.user_tenants
  where tenant_id = _tenant and user_id = _to_user;
  if _target_status is null then
    raise exception 'that person is not a member of this restaurant' using errcode = 'P0002';
  end if;
  if _target_status <> 'active' then
    raise exception 'that member is not active yet' using errcode = '22023';
  end if;

  select id into _owner_role   from public.roles where tenant_id = _tenant and is_system and base_role = 'owner'   limit 1;
  select id into _manager_role from public.roles where tenant_id = _tenant and is_system and base_role = 'manager' limit 1;

  -- Promote target to owner, demote caller to manager (single transaction).
  update public.user_tenants
  set role = 'owner', role_id = _owner_role
  where tenant_id = _tenant and user_id = _to_user;

  update public.user_tenants
  set role = 'manager', role_id = _manager_role
  where tenant_id = _tenant and user_id = _caller;
end $$;

revoke execute on function public.transfer_tenant_ownership(uuid, uuid) from public, anon;
grant  execute on function public.transfer_tenant_ownership(uuid, uuid) to authenticated;

-- ============================================================================
-- 5. request_tenant_deletion / cancel_tenant_deletion: schedule (or unschedule)
--    a purge 7 days out. No hard delete here.
-- ============================================================================
create or replace function public.request_tenant_deletion(_tenant uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare _at timestamptz;
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  _at := now() + interval '7 days';
  update public.tenants set deletion_scheduled_at = _at where id = _tenant;
  return _at;
end $$;

revoke execute on function public.request_tenant_deletion(uuid) from public, anon;
grant  execute on function public.request_tenant_deletion(uuid) to authenticated;

create or replace function public.cancel_tenant_deletion(_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.tenants set deletion_scheduled_at = null where id = _tenant;
end $$;

revoke execute on function public.cancel_tenant_deletion(uuid) from public, anon;
grant  execute on function public.cancel_tenant_deletion(uuid) to authenticated;

-- ============================================================================
-- 6. purge_scheduled_tenants(): hard-delete tenants past their grace deadline.
--    on-delete-cascade FKs wipe every tenant-scoped table. Platform-internal:
--    runs as owner via pg_cron, no grant to authenticated.
-- ============================================================================
create or replace function public.purge_scheduled_tenants()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _n integer;
begin
  delete from public.tenants
  where deletion_scheduled_at is not null and deletion_scheduled_at <= now();
  get diagnostics _n = row_count;
  return _n;
end $$;

revoke execute on function public.purge_scheduled_tenants() from public, anon, authenticated;

-- Daily at 03:30 UTC (after dunning at 03:00).
select cron.schedule('purge-scheduled-tenants-daily', '30 3 * * *', 'select public.purge_scheduled_tenants()');
