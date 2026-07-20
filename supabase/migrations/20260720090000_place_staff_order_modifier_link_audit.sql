-- ============================================================================
-- place_staff_order hardening — two cleanup-debt fixes, done together because
-- both live in this one function body:
--
--  1. Modifier↔item link is now validated. The prior version checked a modifier
--     belonged to the *tenant* but not that it's linked to *this item* via
--     item_modifiers — so "Extra cheese" could be priced onto a beer. addItem()
--     in app/(app)/pos/actions.ts gets the same check in the same change; the
--     two must agree to the cent.
--  2. Off-menu custom lines carry a client-supplied price (no server-side truth
--     for "birthday cake plating"). Rule #5 says a hand-typed price is an
--     audited price change — every custom line now writes an audit_logs row.
--
-- `create or replace` cannot change arity but CAN replace a same-signature body,
-- and the signature is unchanged here (10 args). Grants persist across replace,
-- but we re-issue them below to stay explicit — this fn must never reach anon.
-- ============================================================================

create or replace function public.place_staff_order(
  _tenant           uuid,
  _idempotency_key  text,
  _table_id         uuid,
  _order_type       public.order_type,
  _items            jsonb,
  _guests           integer default null,
  _waiter           uuid    default null,
  _customer         uuid    default null,
  _customer_name    text    default null,
  _customer_phone   text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- POS produces dine-in and pickup only. 'qr' has its own public RPC and
  -- 'delivery' is unreachable from this surface; accepting them here would
  -- silently create orders no POS screen knows how to finish.
  if _order_type not in ('dine_in', 'pickup') then
    raise exception 'POS places dine-in or pickup orders only' using errcode = '22023';
  end if;
  -- A table implies dine-in. Refuse the contradiction rather than pick a winner.
  if _table_id is not null and _order_type <> 'dine_in' then
    raise exception 'a table implies a dine-in order' using errcode = '22023';
  end if;

  -- SECURITY DEFINER bypasses RLS, so every id from the client is checked
  -- against _tenant explicitly. An unchecked id here is a cross-tenant write.
  if _table_id is not null then
    select branch_id into _branch from public.restaurant_tables
    where id = _table_id and tenant_id = _tenant;
    if not found then
      raise exception 'table does not belong to this tenant' using errcode = '22023';
    end if;
  end if;

  -- Replay fast path: a committed order must not be mutated, and must not
  -- leave a stray customer row behind. Return before any write. The
  -- on-conflict below still guards the genuine concurrent-submit race.
  select id into _order from public.orders
  where tenant_id = _tenant and idempotency_key = _idempotency_key;
  if _order is not null then
    return _order;
  end if;

  -- auth.uid() survives SECURITY DEFINER — it reads a JWT GUC, not the role.
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

  -- Customer: an explicit id must be ours; otherwise find-or-create by phone,
  -- matching attach_bill_customer (20260713090000_loyalty_redeem.sql) so the
  -- two paths can't disagree about what "the same customer" means.
  _cname  := nullif(trim(_customer_name), '');
  _cphone := nullif(trim(_customer_phone), '');
  if _customer is not null then
    select id into _cust from public.customers
    where id = _customer and tenant_id = _tenant;
    if _cust is null then
      raise exception 'customer does not belong to this tenant' using errcode = '22023';
    end if;
  elsif _cname is not null or _cphone is not null then
    if _cphone is not null then
      select id into _cust from public.customers
      where tenant_id = _tenant and phone = _cphone limit 1;
    end if;
    if _cust is null then
      insert into public.customers (tenant_id, name, phone)
      values (_tenant, coalesce(_cname, 'Guest'), _cphone) returning id into _cust;
    end if;
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

    -- Custom (off-menu) line. item_id stays null so it can never impersonate a
    -- menu item's price, and fire_order's coalesce(station_id, nil) grouping
    -- routes it onto the expo ticket rather than dropping it.
    _name := nullif(trim(coalesce(_line->>'custom_name', '')), '');
    if _name is not null then
      -- The one client-supplied price in the system: there is no server-side
      -- truth for "birthday cake plating charge". Clamped, and staff-only.
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
      -- Rule #5: a hand-typed price is a price change → audited. Mirrors the
      -- audit addCustomItem writes for the amend path.
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
    -- Skip, don't abort: an item 86'd during an offline outage must not reject
    -- the whole queued order. The UI reopens against the real server rows after
    -- create, so a dropped line is visible rather than assumed.
    if _item.id is null then continue; end if;

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

    -- Every requested modifier must be linked to THIS item via item_modifiers,
    -- not merely owned by the tenant — otherwise "Extra cheese" prices onto a
    -- beer. Reject the whole line rather than silently drop the stray add-on, so
    -- the till total the guest saw and the kitchen ticket can't disagree.
    if cardinality(_modids) > 0 then
      if (
        select count(*) from public.item_modifiers im
        where im.tenant_id = _tenant and im.item_id = _item.id
          and im.modifier_id = any(_modids)
      ) <> cardinality(_modids) then
        raise exception 'modifier not available for this item' using errcode = '22023';
      end if;
    end if;

    -- Trusted prices, always re-fetched. The client's numbers are for its own
    -- running total and never reach this table.
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
end $$;

-- Signature unchanged, so grants persist — re-issued here to stay explicit.
revoke execute on function public.place_staff_order(
  uuid, text, uuid, public.order_type, jsonb, integer, uuid, uuid, text, text
) from anon, public;
grant execute on function public.place_staff_order(
  uuid, text, uuid, public.order_type, jsonb, integer, uuid, uuid, text, text
) to authenticated;
