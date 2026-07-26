-- Wave C: per-line hold — a held line is staged but not fired to the kitchen
-- until released. fire_order skips held (and voided) lines.
alter table public.order_items add column if not exists is_held boolean not null default false;

create or replace function public.fire_order(_order_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = _tenant
  ) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;

  for _station in
    select distinct r.station_id
    from public.order_items oi
    left join public.item_station_routes r
      on r.item_id = oi.item_id and r.tenant_id = _tenant
    where oi.order_id = _order_id
      and oi.is_void = false
      and oi.is_held = false
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
      and oi.is_held = false
      and coalesce(r.station_id, _nil) = coalesce(_station, _nil)
      and not exists (select 1 from public.kot_items ki where ki.order_item_id = oi.id);
  end loop;

  update public.order_items oi
  set status = 'in_kitchen'
  where oi.order_id = _order_id
    and oi.is_void = false
    and exists (select 1 from public.kot_items ki where ki.order_item_id = oi.id)
    and oi.status in ('draft', 'placed');

  update public.orders
  set status = 'in_kitchen', placed_at = coalesce(placed_at, now())
  where id = _order_id and status in ('draft', 'placed');

  return _kots_created;
end $function$;
