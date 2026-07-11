-- ============================================================================
-- KOT firing (order lifecycle: placed → in_kitchen).
-- Splits an order's items into one KOT per kitchen station (grill/bar/…),
-- routed via item_station_routes; items with no route go to a NULL-station
-- ("expo") KOT. Atomic + SECURITY DEFINER, but authorizes the caller against
-- the order's tenant membership first (never trust the client).
-- Idempotent per item: only items not already ticketed get added.
-- ============================================================================

create or replace function public.fire_order(_order_id uuid)
returns integer                       -- number of KOTs created
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _station uuid;
  _kot uuid;
  _kots_created integer := 0;
  _nil uuid := '00000000-0000-0000-0000-000000000000';
begin
  select tenant_id into _tenant from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- Authorize: caller must be a member of the order's tenant.
  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = _tenant
  ) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;

  -- One KOT per distinct station among not-yet-ticketed, non-void items.
  for _station in
    select distinct r.station_id
    from public.order_items oi
    left join public.item_station_routes r
      on r.item_id = oi.item_id and r.tenant_id = _tenant
    where oi.order_id = _order_id
      and oi.is_void = false
      and not exists (select 1 from public.kot_items ki where ki.order_item_id = oi.id)
  loop
    insert into public.kots (tenant_id, order_id, station_id, status)
    values (_tenant, _order_id, _station, 'new')
    returning id into _kot;
    _kots_created := _kots_created + 1;

    insert into public.kot_items (tenant_id, kot_id, order_item_id, qty, status)
    select _tenant, _kot, oi.id, oi.qty, 'new'
    from public.order_items oi
    left join public.item_station_routes r
      on r.item_id = oi.item_id and r.tenant_id = _tenant
    where oi.order_id = _order_id
      and oi.is_void = false
      and coalesce(r.station_id, _nil) = coalesce(_station, _nil)
      and not exists (select 1 from public.kot_items ki where ki.order_item_id = oi.id);
  end loop;

  -- Ticketed items move to in_kitchen.
  update public.order_items oi
  set status = 'in_kitchen'
  where oi.order_id = _order_id
    and oi.is_void = false
    and exists (select 1 from public.kot_items ki where ki.order_item_id = oi.id)
    and oi.status in ('draft', 'placed');

  -- Advance order lifecycle.
  update public.orders
  set status = 'in_kitchen', placed_at = coalesce(placed_at, now())
  where id = _order_id and status in ('draft', 'placed');

  return _kots_created;
end $$;

revoke execute on function public.fire_order(uuid) from public;
grant execute on function public.fire_order(uuid) to authenticated;
