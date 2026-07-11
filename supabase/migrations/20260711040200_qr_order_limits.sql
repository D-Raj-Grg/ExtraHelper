-- ============================================================================
-- QR order abuse hardening (anon surface): per-line qty cap, max lines per
-- order, and a short per-table rate limit to stop order spam.
-- ============================================================================
create or replace function public.place_qr_order(_token uuid, _items jsonb)
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
  _count  integer := 0;
  _recent integer;
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

  insert into public.orders (tenant_id, branch_id, table_id, order_type, status, placed_at)
  values (_tenant, _branch, _table, 'qr', 'placed', now())
  returning id into _order;

  for _line in select * from jsonb_array_elements(_items)
  loop
    select id, name, base_price_cents into _item
    from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant
      and is_active and not is_86;
    if _item.id is not null then
      insert into public.order_items (tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _item.name,
              least(_max_qty, greatest(1, coalesce((_line->>'qty')::int, 1))),
              _item.base_price_cents, 'placed');
      _count := _count + 1;
    end if;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
  end if;

  update public.restaurant_tables set state = 'occupied'
  where id = _table and state = 'free';

  return _order;
end $$;

revoke execute on function public.place_qr_order(uuid, jsonb) from public;
grant execute on function public.place_qr_order(uuid, jsonb) to anon, authenticated;
