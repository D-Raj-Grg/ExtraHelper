-- ============================================================================
-- Two holes left by letting a billed order take new lines. Both are money.
--
-- 1. CHARGED BUT NEVER COOKED.
--    A line added by the amend RPCs lands `status = 'draft'`, and
--    `recompute_bill` sums every line that isn't void — status doesn't come
--    into it. So the instant a waiter taps a beer in the composer, the bill
--    goes up. Firing is a *separate* tap ("Send new items"), and a draft line
--    produces no `kot_items` at all, so if they back out, get distracted, or
--    the app dies, the guest is charged for something the kitchen was never
--    told about. No ticket exists to be missing, so nothing downstream can
--    catch it.
--
--    On an unbilled order that gap is harmless — there is no bill yet, and
--    `create_bill_for_order` is the moment of truth. On a BILLED order the
--    charge is already live, so the two must not be allowed to drift apart:
--    fire the line in the same transaction that charges for it.
--
--    Deliberately only for `billed` orders. Composing a fresh order still
--    batches, because that is the whole point of a cart — the waiter is still
--    at the table deciding, and nothing is charged yet.
--
-- 2. A SPLIT LEAVES THE SOURCE BILL OVERCHARGING.
--    `trg_sync_open_bill` resolved the bill from `new.order_id` only.
--    `split_order_items` (20260713130623) moves a line by updating
--    `order_id` to a brand-new order whose `bill_id` is null — so the trigger
--    read null, returned early, and the ORIGINAL open bill kept charging for a
--    line that now sits on somebody else's tab. Splitting a table mid-service
--    is exactly when that hurts. An UPDATE now syncs both sides.
-- ============================================================================

-- Re-fire is safe by construction: `fire_order_kots` only tickets lines with no
-- `kot_items` row, and its status promotions are scoped to ('draft','placed'),
-- so a billed order stays billed and nothing already cooking reprints. It is
-- SECURITY DEFINER with execute revoked from authenticated — reachable here
-- only because these callers are themselves definer-owned.
create or replace function public.amend_order_add_item(
  _order_id     uuid,
  _item_id      uuid,
  _qty          integer default 1,
  _variant_id   uuid    default null,
  _modifier_ids uuid[]  default null,
  _notes        text    default null,
  _course       integer default null,
  _seat         integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    -- The charge is already live, so the kitchen learns about it now — not on a
    -- second tap that may never come. Modifiers are inserted first so the
    -- ticket prints the line as ordered.
    perform public.fire_order_kots(_order_id, _tenant);
    perform public.recompute_bill(_bill);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'billed_order_amended', 'bill', _bill,
            jsonb_build_object('order_id', _order_id, 'order_item_id', _oi,
                               'name', _name, 'qty', _q, 'unit_price_cents', _price));
  end if;

  return _oi;
end $$;

revoke execute on function public.amend_order_add_item(
  uuid, uuid, integer, uuid, uuid[], text, integer, integer
) from anon, public;
grant execute on function public.amend_order_add_item(
  uuid, uuid, integer, uuid, uuid[], text, integer, integer
) to authenticated;

create or replace function public.amend_order_add_custom_item(
  _order_id          uuid,
  _name              text,
  _unit_price_cents  integer,
  _qty               integer default 1,
  _notes             text    default null,
  _course            integer default null,
  _seat              integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _status public.order_status;
  _label  text;
  _price  integer;
  _q      integer;
  _c      integer;
  _s      integer;
  _n      text;
  _oi     uuid;
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

  _label := nullif(trim(coalesce(_name, '')), '');
  if _label is null then
    raise exception 'custom item needs a name' using errcode = '22023';
  end if;
  _label := left(_label, 60);

  _price := coalesce(_unit_price_cents, 0);
  if _price < 0 or _price > 10000000 then
    raise exception 'custom item price out of range' using errcode = '22023';
  end if;

  _q := greatest(1, least(99, coalesce(_qty, 1)));
  _n := nullif(trim(_notes), '');
  _c := _course;
  _s := _seat;
  if _c is not null then _c := greatest(1, least(99, _c)); end if;
  if _s is not null then _s := greatest(1, least(99, _s)); end if;

  insert into public.order_items (
    tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents,
    notes, course, seat, status
  )
  values (_tenant, _order_id, null, _label, _q, _price, _n, _c, _s, 'draft')
  returning id into _oi;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    _tenant, auth.uid(), 'custom_price', 'order_item', _oi,
    jsonb_build_object(
      'name', _label, 'unit_price_cents', _price, 'qty', _q,
      'order_id', _order_id, 'source', 'amend_order_add_custom_item'
    )
  );

  if _status = 'billed' then
    -- Same reasoning as the on-menu path: charged now, so cooked now.
    perform public.fire_order_kots(_order_id, _tenant);
    perform public.recompute_bill(_bill);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'billed_order_amended', 'bill', _bill,
            jsonb_build_object('order_id', _order_id, 'order_item_id', _oi,
                               'name', _label, 'qty', _q, 'unit_price_cents', _price));
  end if;

  return _oi;
end $$;

revoke execute on function public.amend_order_add_custom_item(
  uuid, text, integer, integer, text, integer, integer
) from anon, public;
grant execute on function public.amend_order_add_custom_item(
  uuid, text, integer, integer, text, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Hole 2: a line that changes hands has TWO bills to keep honest.
-- ---------------------------------------------------------------------------

create or replace function public.trg_sync_open_bill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _bill    uuid;
  _bstatus public.bill_status;
begin
  -- Resolve and recompute one order's bill, if it has an open one.
  if tg_op <> 'INSERT' then
    select o.bill_id into _bill from public.orders o where o.id = old.order_id;
    if _bill is not null then
      select b.status into _bstatus from public.bills b where b.id = _bill;
      if _bstatus = 'open' then perform public.recompute_bill(_bill); end if;
    end if;
  end if;

  -- On an UPDATE that moved the line to a different order — `split_order_items`
  -- does exactly this — the destination is a second bill, and skipping it was
  -- how the source kept charging for a line it no longer had.
  if tg_op <> 'DELETE'
     and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id) then
    select o.bill_id into _bill from public.orders o where o.id = new.order_id;
    if _bill is not null then
      select b.status into _bstatus from public.bills b where b.id = _bill;
      if _bstatus = 'open' then perform public.recompute_bill(_bill); end if;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Same order on both sides: the OLD branch above already covered it.
    null;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

revoke execute on function public.trg_sync_open_bill() from anon, authenticated, public;

drop trigger if exists trg_order_item_sync_bill on public.order_items;
create trigger trg_order_item_sync_bill
  after insert or update or delete on public.order_items
  for each row execute function public.trg_sync_open_bill();
