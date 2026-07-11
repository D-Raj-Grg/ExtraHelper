-- ============================================================================
-- QR dine-in ordering (public / anon). Customers scan a table QR (qr_token) →
-- see the menu → place an order. Exposed via two SECURITY DEFINER functions so
-- anon touches ONLY the tenant resolved from the token — no broad anon RLS.
-- The order lands as a normal 'qr' order (status placed) for waiter confirmation.
-- ============================================================================

-- Public menu + context for a table's QR token.
create or replace function public.qr_menu(_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _label  text;
  _name   text;
  _currency text;
  _menu   jsonb;
begin
  select t.tenant_id, t.label into _tenant, _label
  from public.restaurant_tables t where t.qr_token = _token;
  if _tenant is null then
    return null;
  end if;

  select name into _name from public.tenants where id = _tenant;
  select currency into _currency from public.tenant_settings where tenant_id = _tenant;

  select coalesce(jsonb_agg(cat order by cat->>'name'), '[]'::jsonb) into _menu
  from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', mi.id, 'name', mi.name,
          'description', mi.description, 'price_cents', mi.base_price_cents
        ) order by mi.name)
        from public.menu_items mi
        where mi.category_id = c.id and mi.is_active and not mi.is_86
      ), '[]'::jsonb)
    ) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object(
    'tenant_name', _name, 'currency', coalesce(_currency, 'USD'),
    'table_label', _label, 'categories', _menu
  );
end $$;

-- Place a QR order. _items = [{item_id, qty}].
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
begin
  select t.tenant_id, t.branch_id, t.id into _tenant, _branch, _table
  from public.restaurant_tables t where t.qr_token = _token;
  if _tenant is null then
    raise exception 'invalid table code' using errcode = 'P0002';
  end if;
  if _items is null or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode = '22023';
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
              greatest(1, coalesce((_line->>'qty')::int, 1)), _item.base_price_cents, 'placed');
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

revoke execute on function public.qr_menu(uuid) from public;
revoke execute on function public.place_qr_order(uuid, jsonb) from public;
grant execute on function public.qr_menu(uuid) to anon, authenticated;
grant execute on function public.place_qr_order(uuid, jsonb) to anon, authenticated;
