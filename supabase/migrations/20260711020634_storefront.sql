-- ============================================================================
-- Online storefront (public / anon). Per-tenant by slug: menu → cart → order
-- (delivery/pickup) with an order-type fee from tenant settings. Same
-- controlled-anon pattern as QR: SECURITY DEFINER fns scoped by slug/token.
-- ============================================================================

-- Public menu + context for a storefront slug.
create or replace function public.storefront_menu(_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  _tenant uuid; _name text; _currency text; _fees jsonb; _menu jsonb;
begin
  select id, name into _tenant, _name from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then return null; end if;
  select currency, coalesce(order_type_fees,'{}'::jsonb) into _currency, _fees
  from public.tenant_settings where tenant_id = _tenant;

  select coalesce(jsonb_agg(cat order by cat->>'name'), '[]'::jsonb) into _menu
  from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name,
        'description', mi.description, 'price_cents', mi.base_price_cents) order by mi.name)
      from public.menu_items mi
      where mi.category_id = c.id and mi.is_active and not mi.is_86
    ), '[]'::jsonb)) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object('tenant_name', _name, 'currency', coalesce(_currency,'USD'),
    'fees', _fees, 'categories', _menu);
end $$;

-- Place an online order (delivery/pickup). Returns the online_order id.
create or replace function public.place_online_order(
  _slug text, _items jsonb, _fulfillment text,
  _name text, _phone text, _address jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _cust uuid; _order uuid; _online uuid;
  _fee_units numeric; _fee_cents integer := 0;
  _line jsonb; _item record; _count integer := 0;
  _ftype public.order_type;
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

  insert into public.customers (tenant_id, name, phone) values (_tenant, _name, _phone)
  returning id into _cust;

  insert into public.orders (tenant_id, order_type, status, customer_id, placed_at)
  values (_tenant, _ftype, 'placed', _cust, now()) returning id into _order;

  for _line in select * from jsonb_array_elements(_items) loop
    select id, name, base_price_cents into _item from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant and is_active and not is_86;
    if _item.id is not null then
      insert into public.order_items (tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _item.name,
              greatest(1, least(99, coalesce((_line->>'qty')::int,1))), _item.base_price_cents, 'placed');
      _count := _count + 1;
    end if;
  end loop;
  if _count = 0 then raise exception 'no valid items' using errcode='22023'; end if;

  insert into public.online_orders (tenant_id, order_id, customer_id, channel, fulfillment, address, fee_cents, status)
  values (_tenant, _order, _cust, 'web', _ftype, _address, _fee_cents, 'received')
  returning id into _online;

  return _online;
end $$;

revoke execute on function public.storefront_menu(text) from public;
revoke execute on function public.place_online_order(text, jsonb, text, text, text, jsonb) from public;
grant execute on function public.storefront_menu(text) to anon, authenticated;
grant execute on function public.place_online_order(text, jsonb, text, text, text, jsonb) to anon, authenticated;
