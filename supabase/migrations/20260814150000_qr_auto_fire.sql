-- ============================================================================
-- QR orders never reached the kitchen.
--
-- `place_qr_order` wrote `orders` + `order_items` and stopped there. The KDS
-- boards (web `/kds`, Flutter kitchen) read `kots`, and the only thing that
-- ever wrote a KOT was `fire_order` — which no client calls for a QR order
-- (POS fires what POS created). A guest order sat at `placed` forever: visible
-- on the orders board, invisible to the cooks.
--
-- Fix: the ticket-building half of `fire_order` becomes its own function so the
-- anon QR path can reach it, and a per-tenant `qr_auto_fire` flag decides
-- whether a guest order goes straight to the kitchen (default) or waits for a
-- waiter to accept it via `accept_qr_order`.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists qr_auto_fire boolean not null default true;

comment on column public.tenant_settings.qr_auto_fire is
  'true: a QR order builds its KOTs on placement. false: a waiter must accept it (accept_qr_order) first.';

-- ---------------------------------------------------------------------------
-- The ticket builder, lifted verbatim out of fire_order.
--
-- No caller-identity check in here on purpose: it is called by SECURITY
-- DEFINER functions that have already decided who may fire what — including
-- `place_qr_order`, whose caller is an anonymous guest holding a table token.
-- Execute is revoked from every client role so it cannot be reached directly.
-- ---------------------------------------------------------------------------
create or replace function public.fire_order_kots(_order_id uuid, _tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _station uuid;
  _kot uuid;
  _kots_created integer := 0;
  _nil uuid := '00000000-0000-0000-0000-000000000000';
begin
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
end $$;

revoke execute on function public.fire_order_kots(uuid, uuid) from public;
revoke execute on function public.fire_order_kots(uuid, uuid) from anon, authenticated;

-- fire_order keeps its signature and its guards; the body is now the shared one.
create or replace function public.fire_order(_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
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

  return public.fire_order_kots(_order_id, _tenant);
end $$;

-- ---------------------------------------------------------------------------
-- QR placement: build the tickets inline when the tenant wants auto-fire.
-- Body is otherwise the 20260711040200 version (abuse caps + rate limit).
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

  -- A tenant with no settings row is treated as auto-fire: a guest order the
  -- kitchen never sees is the worse failure of the two.
  select coalesce(s.qr_auto_fire, true) into _auto
  from public.tenant_settings s where s.tenant_id = _tenant;
  if coalesce(_auto, true) then
    -- Firing must not be able to reject the guest's order.
    --
    -- Building the tickets flips the lines to `in_kitchen`, which is what
    -- `trg_deduct_stock` fires on — and with `block_negative_stock` on it
    -- raises 23514 for any dish whose ingredients would go under. Unhandled,
    -- that rolls back the whole call: the guest gets a staff-worded stock
    -- error and loses every other dish on the order too. Swallowed, the order
    -- stands at `placed` and shows up on the POS board behind the waiter's
    -- "Send to kitchen" button, which surfaces the real message to the person
    -- who can act on it. Same fallback for any future fire-time guard.
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

-- ---------------------------------------------------------------------------
-- Waiter accepts a QR order (confirmation mode). Idempotent: accepting an
-- order whose lines are already ticketed returns 0 rather than erroring, so a
-- double tap on a flaky connection is harmless.
-- ---------------------------------------------------------------------------
create or replace function public.accept_qr_order(_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _type public.order_type;
  _status public.order_status;
begin
  select o.tenant_id, o.order_type, o.status
    into _tenant, _type, _status
  from public.orders o where o.id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = _tenant
  ) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.fire') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _type <> 'qr' then
    raise exception 'not a QR order' using errcode = '22023';
  end if;
  if _status not in ('draft', 'placed', 'in_kitchen') then
    raise exception 'order is no longer waiting for the kitchen' using errcode = '22023';
  end if;

  return public.fire_order_kots(_order_id, _tenant);
end $$;

revoke execute on function public.accept_qr_order(uuid) from public;
-- Default privileges on this project hand `anon` its own EXECUTE grant on every
-- new function, which `revoke ... from public` does not touch. Accepting an
-- order is staff-only; the anon surface is `place_qr_order` and nothing else.
revoke execute on function public.accept_qr_order(uuid) from anon;
grant execute on function public.accept_qr_order(uuid) to authenticated;
