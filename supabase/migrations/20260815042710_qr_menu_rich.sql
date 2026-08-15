-- ============================================================================
-- The QR menu was a price list, not a menu.
--
-- `qr_menu` shipped id/name/description/price/is_veg and nothing else, so the
-- guest page could not show a dish photo — the one thing that sells food — and
-- quoted `base_price_cents` for dishes that have variants, a figure nobody can
-- actually order. Categories came back alphabetical, ignoring the `sort` the
-- restaurant set on them.
--
-- This adds `image_url` and the item's `variants` to the payload, orders
-- categories by their configured sort, and teaches `place_qr_order` to take a
-- `variant_id` per line so a guest who picks "Large" is charged for Large. The
-- variant is re-priced server-side (the client's numbers never reach the table)
-- and must belong to the item, exactly as `place_staff_order` does it.
--
-- Additive: new keys on each item object, an optional key on each order line.
-- Grants persist on `create or replace` for an unchanged signature.
-- ============================================================================

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

  -- Ordered by the restaurant's own `sort` first: a menu reads starters →
  -- mains → desserts, and alphabetical order destroys that every time.
  select coalesce(jsonb_agg(cat order by srt, cat->>'name'), '[]'::jsonb) into _menu
  from (
    select c.sort as srt, jsonb_build_object(
      'id', c.id, 'name', c.name,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', mi.id, 'name', mi.name,
          'description', mi.description, 'price_cents', mi.base_price_cents,
          'is_veg', mi.is_veg, 'image_url', mi.image_url,
          'variants', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', v.id, 'name', v.name, 'price_delta_cents', v.price_delta_cents
            ) order by v.price_delta_cents, v.name)
            from public.item_variants v
            where v.item_id = mi.id and v.tenant_id = _tenant
          ), '[]'::jsonb)
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

-- Same three additions for the public storefront, so the two guest surfaces
-- don't drift into showing different menus for the same kitchen.
create or replace function public.storefront_menu(_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  _tenant uuid; _name text; _currency text; _tz text; _fees jsonb; _menu jsonb;
begin
  select id, name into _tenant, _name from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then return null; end if;
  select currency, timezone, coalesce(order_type_fees,'{}'::jsonb) into _currency, _tz, _fees
  from public.tenant_settings where tenant_id = _tenant;

  select coalesce(jsonb_agg(cat order by srt, cat->>'name'), '[]'::jsonb) into _menu
  from (
    select c.sort as srt, jsonb_build_object('id', c.id, 'name', c.name, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name,
        'description', mi.description, 'price_cents', mi.base_price_cents,
        'is_veg', mi.is_veg, 'image_url', mi.image_url,
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', v.id, 'name', v.name, 'price_delta_cents', v.price_delta_cents
          ) order by v.price_delta_cents, v.name)
          from public.item_variants v
          where v.item_id = mi.id and v.tenant_id = _tenant
        ), '[]'::jsonb)) order by mi.name)
      from public.menu_items mi
      where mi.category_id = c.id and mi.is_active and not mi.is_86
    ), '[]'::jsonb)) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object('tenant_name', _name, 'currency', coalesce(_currency,'USD'),
    'timezone', coalesce(_tz,'UTC'), 'fees', _fees, 'categories', _menu);
end $$;

-- ---------------------------------------------------------------------------
-- Guest placement, now variant-aware. Body is otherwise the 20260814150000
-- version (abuse caps, rate limit, auto-fire with the swallowed fire error).
-- ---------------------------------------------------------------------------
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
  _var    uuid;
  _v      record;
  _price  integer;
  _label  text;
  _count  integer := 0;
  _recent integer;
  _auto   boolean;
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
      _count := _count + 1;
    end if;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
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

revoke execute on function public.place_qr_order(uuid, jsonb) from public;
grant execute on function public.place_qr_order(uuid, jsonb) to anon, authenticated;
