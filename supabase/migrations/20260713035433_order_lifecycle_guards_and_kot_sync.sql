-- Wave D: order lifecycle — KOT bumps propagate to order status, explicit
-- mark-served, and a bill guard (can't bill a draft/cancelled order).

-- 1) Derive order status from its kitchen tickets. order rank = MIN over its
--    KOTs (order is 'served' only when every ticket is served, 'ready' only
--    when all are ready, etc). Only nudges in-kitchen..served — never touches
--    draft/placed/billed/closed/cancelled.
create or replace function public.sync_order_status_from_kots(_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid;
  _cur public.order_status;
  _minrank integer;
  _next public.order_status;
begin
  select tenant_id, status into _tenant, _cur from public.orders where id = _order_id;
  if _tenant is null then return; end if;
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _cur not in ('in_kitchen','preparing','ready','served') then
    return;  -- don't disturb draft/placed/billed/closed/cancelled
  end if;

  select min(case k.status
               when 'new' then 1
               when 'preparing' then 2
               when 'recalled' then 2
               when 'ready' then 3
               when 'served' then 4
               else 1 end)
    into _minrank
  from public.kots k
  where k.order_id = _order_id and k.tenant_id = _tenant;

  if _minrank is null then return; end if;
  _next := case _minrank
             when 1 then 'in_kitchen'
             when 2 then 'preparing'
             when 3 then 'ready'
             else 'served' end;

  update public.orders set status = _next
  where id = _order_id and status in ('in_kitchen','preparing','ready','served');
end $function$;

-- 2) Explicit "mark served" (waiter delivered) — advances order + its tickets.
create or replace function public.mark_order_served(_order_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _cur public.order_status;
begin
  select tenant_id, status into _tenant, _cur from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner','manager','waiter','cashier','kitchen') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _cur not in ('in_kitchen','preparing','ready') then
    raise exception 'order is not in a servable state' using errcode = '22023';
  end if;
  update public.kots set status = 'served'
    where order_id = _order_id and tenant_id = _tenant and status <> 'recalled';
  update public.kot_items ki set status = 'served'
    where ki.tenant_id = _tenant and ki.status <> 'recalled'
      and exists (select 1 from public.kots k where k.id = ki.kot_id and k.order_id = _order_id);
  update public.orders set status = 'served' where id = _order_id;
end $function$;

-- 3) Guard: can only bill a fired (or served) order — never a bare draft or a
--    cancelled order. Re-defines create_bill_for_order with the guard added.
create or replace function public.create_bill_for_order(_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant       uuid;
  _branch       uuid;
  _table        uuid;
  _otype        public.order_type;
  _existing     uuid;
  _status       public.order_status;
  _bill         uuid;
  _subtotal     integer := 0;
  _service_pct  numeric := 0;
  _packaging    numeric := 0;
  _tax_rules    jsonb := '[]';
  _service_cents   integer := 0;
  _packaging_cents integer := 0;
  _tax_cents       integer := 0;
begin
  select tenant_id, branch_id, table_id, order_type, bill_id, status
    into _tenant, _branch, _table, _otype, _existing, _status
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _existing is not null then
    return _existing;
  end if;
  if _status in ('draft','cancelled') then
    raise exception 'order must be fired before billing' using errcode = '22023';
  end if;

  select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
  from public.order_items
  where order_id = _order_id and is_void = false;

  select service_charge, packaging_fee, tax_rules
    into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;

  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then
    _packaging_cents := round(coalesce(_packaging, 0) * 100);
  end if;

  select coalesce(sum(
           round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)
         ), 0)
    into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r
  where coalesce((r->>'inclusive')::boolean, false) = false;

  insert into public.bills (tenant_id, branch_id, table_id, status,
                            subtotal_cents, tax_cents, service_charge_cents,
                            discount_cents, total_cents)
  values (_tenant, _branch, _table, 'open',
          _subtotal, _tax_cents, _service_cents + _packaging_cents,
          0, _subtotal + _service_cents + _packaging_cents + _tax_cents)
  returning id into _bill;

  insert into public.bill_items (tenant_id, bill_id, order_item_id, description,
                                 qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents,
         0, oi.unit_price_cents * oi.qty
  from public.order_items oi
  where oi.order_id = _order_id and oi.is_void = false;

  update public.orders set status = 'billed', bill_id = _bill where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table;
  end if;

  return _bill;
end $function$;

grant execute on function public.sync_order_status_from_kots(uuid) to authenticated;
grant execute on function public.mark_order_served(uuid) to authenticated;

-- 4) Realtime: publish order_items so voids/edits live-propagate to KDS.
alter publication supabase_realtime add table public.order_items;
