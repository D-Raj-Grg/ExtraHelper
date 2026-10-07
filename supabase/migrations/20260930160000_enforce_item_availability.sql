-- Enforce per-item availability windows (item_availability) at order time.
--
-- Until now the windows were data only: nothing read them, so a lunch-only dish
-- could be rung up at midnight. "Now" is the TENANT's wall clock
-- (tenant_settings.timezone), never the client's, so a waiter's phone with the
-- wrong zone cannot sell outside a window.
--
-- Semantics (matches the menu editor, which writes day_of_week 0=Sun..6=Sat or
-- null = every day, plus start_time/end_time):
--   * an item with NO rows is always available;
--   * an item with rows is available when ANY row matches the local time;
--   * start < end: same-day window, start inclusive, end exclusive;
--   * start > end: overnight window (22:00-02:00). The after-midnight part
--     belongs to the day the window STARTED on;
--   * start = end: treated as the whole day.
--
-- Combos are NOT handled here: see TASKS.md note — order_items has no combo
-- link, so a combo cannot be priced/expanded/voided correctly without a schema
-- addition. Nothing in this migration touches combos.
--
-- No arity changes: every create-or-replace below keeps its exact signature,
-- so existing grants carry over (verified against proacl before writing).

create or replace function public.item_available_now(
  _item uuid, _tenant uuid, _at timestamptz default now()
) returns boolean
language plpgsql stable
set search_path to 'public'
as $$
declare
  _tz    text;
  _local timestamp;
  _dow   integer;
  _prev  integer;
  _t     time;
begin
  if not exists (
    select 1 from public.item_availability
    where item_id = _item and tenant_id = _tenant
  ) then
    return true;
  end if;

  select coalesce(nullif(timezone, ''), 'UTC') into _tz
  from public.tenant_settings where tenant_id = _tenant;
  _tz := coalesce(_tz, 'UTC');
  begin
    _local := _at at time zone _tz;
  exception when others then
    _local := _at at time zone 'UTC';   -- a bad zone string must not block selling
  end;
  _dow  := extract(dow from _local)::int;
  _prev := (_dow + 6) % 7;
  _t    := _local::time;

  return exists (
    select 1 from public.item_availability a
    where a.item_id = _item and a.tenant_id = _tenant
      and (
        a.start_time = a.end_time
          and (a.day_of_week is null or a.day_of_week = _dow)
        or a.start_time < a.end_time
          and (a.day_of_week is null or a.day_of_week = _dow)
          and _t >= a.start_time and _t < a.end_time
        or a.start_time > a.end_time
          and (
            ((a.day_of_week is null or a.day_of_week = _dow) and _t >= a.start_time)
            or ((a.day_of_week is null or a.day_of_week = _prev) and _t < a.end_time)
          )
      )
  );
end $$;

revoke execute on function public.item_available_now(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.item_available_now(uuid, uuid, timestamptz) to authenticated;

-- When is it back? Local "today 18:00" / "tomorrow 11:00" / "Tue 18:00" for the
-- soonest window start after now (tenant clock), or null when none exists.
create or replace function public.item_next_available_label(
  _item uuid, _tenant uuid, _at timestamptz default now()
) returns text
language plpgsql stable
set search_path to 'public'
as $$
declare
  _tz text; _local timestamp; _best timestamp;
begin
  select coalesce(nullif(timezone, ''), 'UTC') into _tz
  from public.tenant_settings where tenant_id = _tenant;
  _tz := coalesce(_tz, 'UTC');
  begin
    _local := _at at time zone _tz;
  exception when others then
    _tz := 'UTC';
    _local := _at at time zone 'UTC';
  end;

  select min(cand) into _best from (
    select (_local::date + d) + a.start_time as cand
    from public.item_availability a
    cross join generate_series(0, 7) d
    where a.item_id = _item and a.tenant_id = _tenant
      and (a.day_of_week is null
           or a.day_of_week = extract(dow from (_local::date + d))::int)
  ) c where cand > _local;

  if _best is null then return null; end if;
  return case
    when _best::date = _local::date     then 'today '    || to_char(_best, 'HH24:MI')
    when _best::date = _local::date + 1 then 'tomorrow ' || to_char(_best, 'HH24:MI')
    else trim(to_char(_best, 'Dy')) || ' ' || to_char(_best, 'HH24:MI')
  end;
end $$;

revoke execute on function public.item_next_available_label(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.item_next_available_label(uuid, uuid, timestamptz) to authenticated;

-- The one sentence every order path raises (and the POS shows verbatim).
create or replace function public.item_unavailable_message(
  _name text, _item uuid, _tenant uuid
) returns text
language sql stable
set search_path to 'public'
as $$
  select _name || ' is not available right now'
    || coalesce('. Next available ' || public.item_next_available_label(_item, _tenant), '');
$$;

revoke execute on function public.item_unavailable_message(text, uuid, uuid) from public, anon;
grant execute on function public.item_unavailable_message(text, uuid, uuid) to authenticated;

-- What the POS greys out: this tenant's items outside their window right now
-- (tenant clock) with a "back at" label. Security invoker: RLS already lets
-- every member read item_availability.
create or replace function public.unavailable_items(_tenant uuid)
returns table (item_id uuid, next_label text)
language sql stable
set search_path to 'public'
as $$
  select i.item_id, public.item_next_available_label(i.item_id, _tenant)
  from (select distinct a.item_id from public.item_availability a
        where a.tenant_id = _tenant) i
  where not public.item_available_now(i.item_id, _tenant);
$$;

revoke execute on function public.unavailable_items(uuid) from public, anon;
grant execute on function public.unavailable_items(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Menu reads for the public surfaces: hide what cannot be ordered right now.
-- ---------------------------------------------------------------------------
create or replace function public.qr_menu(_token uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
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
          and public.item_available_now(mi.id, _tenant)
      ), '[]'::jsonb)
    ) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object(
    'tenant_name', _name, 'currency', coalesce(_currency, 'USD'),
    'table_label', _label, 'categories', _menu
  );
end $function$;

create or replace function public.storefront_menu(_slug text)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
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
        and public.item_available_now(mi.id, _tenant)
    ), '[]'::jsonb)) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object('tenant_name', _name, 'currency', coalesce(_currency,'USD'),
    'timezone', coalesce(_tz,'UTC'), 'fees', _fees, 'categories', _menu);
end $function$;

-- ---------------------------------------------------------------------------
-- Order paths: reject a line outside its window, naming the dish.
-- (A stale menu on a guest's phone is the normal way to hit this.)
-- ---------------------------------------------------------------------------

-- place_staff_order: identical to 20260927090000's body plus the window check.
create or replace function public.place_staff_order(
  _tenant uuid, _idempotency_key text, _table_id uuid, _order_type order_type,
  _items jsonb, _guests integer default null, _waiter uuid default null,
  _customer uuid default null, _customer_name text default null,
  _customer_phone text default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  _branch uuid;
  _order  uuid;
  _line   jsonb;
  _item   record;
  _v      record;
  _count  integer := 0;
  _oi     uuid;
  _name   text;
  _price  integer;
  _qty    integer;
  _notes  text;
  _course integer;
  _seat   integer;
  _var    uuid;
  _modids uuid[];
  _mprice integer;
  _cust   uuid;
  _cname  text;
  _cphone text;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if coalesce(trim(_idempotency_key), '') = '' then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode = '22023';
  end if;

  if _order_type not in ('dine_in', 'pickup') then
    raise exception 'POS places dine-in or pickup orders only' using errcode = '22023';
  end if;
  if _table_id is not null and _order_type <> 'dine_in' then
    raise exception 'a table implies a dine-in order' using errcode = '22023';
  end if;

  if _table_id is not null then
    select branch_id into _branch from public.restaurant_tables
    where id = _table_id and tenant_id = _tenant;
    if not found then
      raise exception 'table does not belong to this tenant' using errcode = '22023';
    end if;
  end if;

  select id into _order from public.orders
  where tenant_id = _tenant and idempotency_key = _idempotency_key;
  if _order is not null then
    return _order;
  end if;

  _waiter := coalesce(_waiter, auth.uid());
  if _waiter is not null and not exists (
    select 1 from public.user_tenants
    where user_id = _waiter and tenant_id = _tenant and status = 'active'
  ) then
    raise exception 'staff member is not on this tenant' using errcode = '22023';
  end if;

  if _guests is not null and (_guests < 1 or _guests > 200) then
    raise exception 'guests out of range' using errcode = '22023';
  end if;

  _cname  := nullif(trim(_customer_name), '');
  _cphone := nullif(trim(_customer_phone), '');
  if _customer is not null then
    select id into _cust from public.customers
    where id = _customer and tenant_id = _tenant;
    if _cust is null then
      raise exception 'customer does not belong to this tenant' using errcode = '22023';
    end if;
  elsif _cname is not null or _cphone is not null then
    _cust := public.customer_for_phone(_tenant, _cname, _cphone);
  end if;

  insert into public.orders (
    tenant_id, branch_id, table_id, order_type, status, idempotency_key,
    guests, waiter_id, customer_id
  )
  values (
    _tenant, _branch, _table_id, _order_type, 'draft', _idempotency_key,
    _guests, _waiter, _cust
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into _order;

  if _order is null then
    select id into _order from public.orders
    where tenant_id = _tenant and idempotency_key = _idempotency_key;
    return _order;
  end if;

  for _line in select * from jsonb_array_elements(_items)
  loop
    _qty    := greatest(1, least(99, coalesce((_line->>'qty')::int, 1)));
    _notes  := nullif(trim(_line->>'notes'), '');
    _course := nullif(_line->>'course', '')::int;
    _seat   := nullif(_line->>'seat', '')::int;
    if _course is not null then _course := greatest(1, least(99, _course)); end if;
    if _seat   is not null then _seat   := greatest(1, least(99, _seat));   end if;

    _name := nullif(trim(coalesce(_line->>'custom_name', '')), '');
    if _name is not null then
      _price := coalesce((_line->>'unit_price_cents')::int, 0);
      if _price < 0 or _price > 10000000 then
        raise exception 'custom item price out of range' using errcode = '22023';
      end if;
      insert into public.order_items (
        tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents,
        notes, course, seat, status
      )
      values (_tenant, _order, null, _name, _qty, _price, _notes, _course, _seat, 'draft')
      returning id into _oi;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
      values (_tenant, auth.uid(), 'custom_price', 'order_item', _oi,
              jsonb_build_object('name', _name, 'unit_price_cents', _price,
                                 'qty', _qty, 'order_id', _order, 'source', 'place_staff_order'));
      _count := _count + 1;
      continue;
    end if;

    select id, name, base_price_cents into _item
    from public.menu_items
    where id = nullif(_line->>'item_id', '')::uuid and tenant_id = _tenant
      and is_active and not is_86;
    if _item.id is null then continue; end if;

    -- Outside its availability window (tenant clock). Unlike 86, this rejects
    -- the whole order: the till must say which dish, not sell it quietly.
    if not public.item_available_now(_item.id, _tenant) then
      raise exception '%', public.item_unavailable_message(_item.name, _item.id, _tenant)
        using errcode = '22023', hint = 'item_unavailable';
    end if;

    _price := _item.base_price_cents;
    _name  := _item.name;
    _var   := nullif(_line->>'variant_id', '')::uuid;

    if _var is not null then
      select name, price_delta_cents into _v
      from public.item_variants
      where id = _var and item_id = _item.id and tenant_id = _tenant;
      if not found then
        raise exception 'variant not found' using errcode = '22023';
      end if;
      _price := _price + _v.price_delta_cents;
      _name  := _item.name || ' (' || _v.name || ')';
    end if;

    if jsonb_typeof(_line->'modifier_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into _modids
      from jsonb_array_elements_text(_line->'modifier_ids') x;
    else
      _modids := '{}'::uuid[];
    end if;

    if cardinality(_modids) > 0 then
      if (
        select count(*) from public.item_modifiers im
        where im.tenant_id = _tenant and im.item_id = _item.id
          and im.modifier_id = any(_modids)
      ) <> cardinality(_modids) then
        raise exception 'modifier not available for this item' using errcode = '22023';
      end if;
    end if;

    select coalesce(sum(price_cents), 0) into _mprice
    from public.modifiers where tenant_id = _tenant and id = any(_modids);
    _price := _price + _mprice;

    insert into public.order_items (
      tenant_id, order_id, item_id, variant_id, name_snapshot, qty,
      unit_price_cents, notes, course, seat, status
    )
    values (
      _tenant, _order, _item.id, _var, _name, _qty,
      _price, _notes, _course, _seat, 'draft'
    )
    returning id into _oi;

    insert into public.order_item_modifiers (
      tenant_id, order_item_id, modifier_id, name_snapshot, qty, price_cents
    )
    select _tenant, _oi, m.id, m.name, 1, m.price_cents
    from public.modifiers m
    where m.tenant_id = _tenant and m.id = any(_modids);

    _count := _count + 1;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
  end if;

  if _table_id is not null then
    update public.restaurant_tables set state = 'occupied'
    where id = _table_id and tenant_id = _tenant and state = 'free';
  end if;

  return _order;
end $function$;

-- amend_order_add_item: the same rule for lines added after the order exists.
create or replace function public.amend_order_add_item(
  _order_id uuid, _item_id uuid, _qty integer default 1, _variant_id uuid default null,
  _modifier_ids uuid[] default null, _notes text default null,
  _course integer default null, _seat integer default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  _tenant uuid;
  _status public.order_status;
  _item   record;
  _v      record;
  _price  integer;
  _name   text;
  _modids uuid[];
  _mprice integer;
  _oi     uuid;
  _q      integer;
  _c      integer;
  _s      integer;
  _n      text;
  _bill   uuid;
  _bstatus public.bill_status;
begin
  select tenant_id, status into _tenant, _status
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = '22023';
  end if;

  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.create') then
    raise exception 'not permitted to add items' using errcode = '42501';
  end if;

  if _status in ('closed', 'cancelled') then
    raise exception 'order is % and cannot be amended', _status using errcode = '22023';
  end if;

  if _status = 'billed' then
    select o.bill_id into _bill from public.orders o where o.id = _order_id;
    select b.status into _bstatus from public.bills b where b.id = _bill;
    if _bstatus is distinct from 'open'
       or exists (select 1 from public.payments p
                  where p.bill_id = _bill and p.status = 'completed') then
      raise exception 'this bill has already taken a payment — start a new order for the table'
        using errcode = '22023';
    end if;
  end if;

  _q := greatest(1, least(99, coalesce(_qty, 1)));
  _n := nullif(trim(_notes), '');
  _c := _course;
  _s := _seat;
  if _c is not null then _c := greatest(1, least(99, _c)); end if;
  if _s is not null then _s := greatest(1, least(99, _s)); end if;

  select id, name, base_price_cents, is_86 into _item
  from public.menu_items
  where id = _item_id and tenant_id = _tenant and is_active;
  if _item.id is null then
    raise exception 'item not found' using errcode = '22023';
  end if;
  if _item.is_86 then
    raise exception '% is 86''d (out of stock)', _item.name using errcode = '22023';
  end if;
  if not public.item_available_now(_item.id, _tenant) then
    raise exception '%', public.item_unavailable_message(_item.name, _item.id, _tenant)
        using errcode = '22023', hint = 'item_unavailable';
  end if;

  _price := _item.base_price_cents;
  _name  := _item.name;

  if _variant_id is not null then
    select name, price_delta_cents into _v
    from public.item_variants
    where id = _variant_id and item_id = _item.id and tenant_id = _tenant;
    if not found then
      raise exception 'variant not found' using errcode = '22023';
    end if;
    _price := _price + _v.price_delta_cents;
    _name  := _item.name || ' (' || _v.name || ')';
  end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into _modids
  from unnest(coalesce(_modifier_ids, '{}'::uuid[])) x;

  if cardinality(_modids) > 0 then
    if (
      select count(*) from public.item_modifiers im
      where im.tenant_id = _tenant and im.item_id = _item.id
        and im.modifier_id = any(_modids)
    ) <> cardinality(_modids) then
      raise exception 'modifier not available for this item' using errcode = '22023';
    end if;
  end if;

  select coalesce(sum(price_cents), 0) into _mprice
  from public.modifiers where tenant_id = _tenant and id = any(_modids);
  _price := _price + _mprice;

  insert into public.order_items (
    tenant_id, order_id, item_id, variant_id, name_snapshot, qty,
    unit_price_cents, notes, course, seat, status
  )
  values (
    _tenant, _order_id, _item.id, _variant_id, _name, _q,
    _price, _n, _c, _s, 'draft'
  )
  returning id into _oi;

  insert into public.order_item_modifiers (
    tenant_id, order_item_id, modifier_id, name_snapshot, qty, price_cents
  )
  select _tenant, _oi, m.id, m.name, 1, m.price_cents
  from public.modifiers m
  where m.tenant_id = _tenant and m.id = any(_modids);

  if _status = 'billed' then
    perform public.fire_order_kots(_order_id, _tenant);
    perform public.recompute_bill(_bill);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'billed_order_amended', 'bill', _bill,
            jsonb_build_object('order_id', _order_id, 'order_item_id', _oi,
                               'name', _name, 'qty', _q, 'unit_price_cents', _price));
  end if;

  return _oi;
end $function$;

-- place_qr_order
create or replace function public.place_qr_order(
  _token uuid, _items jsonb, _coupon text default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
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
  _max_qty  constant integer := 20;
  _max_lines constant integer := 40;
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

  select count(*) into _recent
  from public.orders
  where table_id = _table and order_type = 'qr'
    and created_at > now() - interval '30 seconds';
  if _recent >= 3 then
    raise exception 'Too many orders — please wait a moment before ordering again'
      using errcode = '53400';
  end if;

  if coalesce(trim(_coupon), '') <> '' and exists (
    select 1 from public.orders o
    left join public.discounts d on d.bill_id = o.bill_id and d.coupon_id is not null
    where o.table_id = _table and o.order_type = 'qr'
      and o.status not in ('closed', 'cancelled')
      and o.created_at > now() - interval '6 hours'
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
      -- The guest's menu may be stale; say which dish went off the menu.
      if not public.item_available_now(_item.id, _tenant) then
        raise exception '%', public.item_unavailable_message(_item.name, _item.id, _tenant)
        using errcode = '22023', hint = 'item_unavailable';
      end if;

      _price := _item.base_price_cents;
      _label := _item.name;
      _var   := nullif(_line->>'variant_id', '')::uuid;

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

  if coalesce(trim(_coupon), '') <> '' then
    _c := public._coupon_lookup(_tenant, _coupon, _subtotal, 'qr', null);
    update public.orders set coupon_code = _c.code where id = _order;
  end if;

  update public.restaurant_tables set state = 'occupied'
  where id = _table and state = 'free';

  select coalesce(s.qr_auto_fire, true) into _auto
  from public.tenant_settings s where s.tenant_id = _tenant;
  if coalesce(_auto, true) then
    begin
      perform public.fire_order_kots(_order, _tenant);
    exception when others then
      null;
    end;
  end if;

  return _order;
end $function$;

-- place_online_order (storefront)
create or replace function public.place_online_order(
  _slug text, _items jsonb, _fulfillment text, _name text, _phone text,
  _address jsonb, _coupon text default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
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

  _cust := public.customer_for_phone(_tenant, _name, _phone);

  insert into public.orders (tenant_id, order_type, status, customer_id, placed_at)
  values (_tenant, _ftype, 'placed', _cust, now()) returning id into _order;

  for _line in select * from jsonb_array_elements(_items) loop
    select id, name, base_price_cents into _item from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant and is_active and not is_86;
    if _item.id is not null then
      if not public.item_available_now(_item.id, _tenant) then
        raise exception '%', public.item_unavailable_message(_item.name, _item.id, _tenant)
        using errcode = '22023', hint = 'item_unavailable';
      end if;
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
end $function$;
