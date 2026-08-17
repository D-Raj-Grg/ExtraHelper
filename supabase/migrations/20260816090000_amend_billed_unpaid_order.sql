-- ============================================================================
-- Let a BILLED order take more items, as long as its bill is still unpaid.
--
-- Both amend RPCs refused `billed` outright, on the reasoning that "a billed
-- order is settled". It isn't. `billed` only records that a bill was
-- GENERATED — the waiter tapped Bill, the printer produced a slip. Nobody has
-- necessarily handed over any money. A table that asks for the bill and then
-- orders one more round is ordinary restaurant behaviour, not an anomaly, and
-- the checkout screen already tells staff exactly that: the bill reprints with
-- the new total. The refusal forced the floor to open a second order for the
-- same table and then reconcile two bills by hand.
--
-- The real point of no return is money changing hands, and that lives on the
-- BILL, not on the order status. So the guard moves there: `closed` and
-- `cancelled` still refuse (settled, and not coming back respectively), while
-- `billed` is allowed through only while the bill is still `open` and has taken
-- no `completed` payment. A `partial`/`paid`/`void` bill, or one with a
-- completed payment against it, is finished — the answer there is a new order
-- for the table, and the error says so.
--
-- Two consequences of allowing the amend, both handled at the end of each
-- function:
--   * The bill's totals are now stale, so `recompute_bill` re-derives them (and
--     rebuilds `bill_items`) — otherwise the printed slip and the till disagree,
--     which is the exact failure `amend_order_add_item` was written to prevent.
--   * Adding to a bill someone has already been shown is a money-facing edit, so
--     it is audited as `billed_order_amended` against the bill.
--
-- Both functions are reproduced verbatim apart from those two changes. The
-- signatures are unchanged — `create or replace` cannot alter arity without
-- silently creating an overload, so the arg lists and defaults below are copied
-- exactly from 20260727090000 and 20260813150000. The permission gates
-- (`has_tenant_role`, `has_permission(_tenant, 'order.create')`) are untouched.
-- ============================================================================

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
  -- Resolve the order first: the tenant comes from the row, never the client.
  select tenant_id, status into _tenant, _status
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = '22023';
  end if;

  -- Same roles that may create an order may amend one.
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  -- And the granular gate, matching the other sensitive DEFINER RPCs
  -- (20260712100000): a UI that hides the button is not a boundary.
  -- Arg order is (_tenant, _key) — plpgsql resolves this call at RUN time, so
  -- getting it backwards creates cleanly and then fails on every amend.
  if not public.has_permission(_tenant, 'order.create') then
    raise exception 'not permitted to add items' using errcode = '42501';
  end if;

  -- A closed order is settled; a cancelled one is not coming back. Adding to
  -- either produces a line nobody will cook or charge for.
  if _status in ('closed', 'cancelled') then
    raise exception 'order is % and cannot be amended', _status using errcode = '22023';
  end if;

  -- 'billed' means a bill was generated, not that anyone paid. A table that
  -- orders another round after asking for the bill is normal (the checkout
  -- screen already says so and reprints). Money changing hands is the real
  -- lock, so gate on the bill, not on the order status.
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
  -- Unlike the create path (which SKIPS an 86'd line so a queued offline order
  -- isn't rejected wholesale), an amend is a live, deliberate tap: the waiter
  -- must be told, not silently ignored.
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

  -- Every requested modifier must be linked to THIS item via item_modifiers,
  -- not merely owned by the tenant — otherwise "Extra cheese" prices onto a
  -- beer. Reject the whole line rather than silently drop the stray add-on.
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

  -- The bill was already printed against the old total. Re-derive it in the
  -- same transaction as the line, and record the edit against the bill.
  if _status = 'billed' then
    perform public.recompute_bill(_bill);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'billed_order_amended', 'bill', _bill,
            jsonb_build_object('order_id', _order_id, 'order_item_id', _oi,
                               'name', _name, 'qty', _q, 'unit_price_cents', _price));
  end if;

  return _oi;
end $$;

-- Postgres grants EXECUTE to PUBLIC by default, so `revoke from anon` alone is
-- not enough — revoke from public, then grant to authenticated, naming the full
-- signature.
revoke execute on function public.amend_order_add_item(
  uuid, uuid, integer, uuid, uuid[], text, integer, integer
) from anon, public;
grant execute on function public.amend_order_add_item(
  uuid, uuid, integer, uuid, uuid[], text, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- The off-menu line takes the identical treatment.
-- ---------------------------------------------------------------------------

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
  -- Resolve the order first: the tenant comes from the row, never the client.
  select tenant_id, status into _tenant, _status
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = '22023';
  end if;

  -- Same roles that may amend an order may add an off-menu line to it.
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  -- Arg order is (_tenant, _key) — plpgsql resolves this at RUN time, so
  -- getting it backwards creates cleanly and then fails on every call.
  if not public.has_permission(_tenant, 'order.create') then
    raise exception 'not permitted to add items' using errcode = '42501';
  end if;

  if _status in ('closed', 'cancelled') then
    raise exception 'order is % and cannot be amended', _status using errcode = '22023';
  end if;

  -- 'billed' means a bill was generated, not that anyone paid. A table that
  -- orders another round after asking for the bill is normal (the checkout
  -- screen already says so and reprints). Money changing hands is the real
  -- lock, so gate on the bill, not on the order status.
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
  -- 60 characters is what fits a thermal ticket line; a longer one is a note.
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

  -- A hand-typed price is a price change, so it is audited — the same row
  -- shape `place_staff_order` writes, differing only in `source`.
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

  -- The bill was already printed against the old total. Re-derive it in the
  -- same transaction as the line, and record the edit against the bill.
  if _status = 'billed' then
    perform public.recompute_bill(_bill);
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'billed_order_amended', 'bill', _bill,
            jsonb_build_object('order_id', _order_id, 'order_item_id', _oi,
                               'name', _label, 'qty', _q, 'unit_price_cents', _price));
  end if;

  return _oi;
end $$;

-- Postgres grants EXECUTE to PUBLIC by default, so `revoke from anon` alone is
-- not enough — revoke from public, then grant to authenticated, naming the full
-- signature.
revoke execute on function public.amend_order_add_custom_item(
  uuid, text, integer, integer, text, integer, integer
) from anon, public;
grant execute on function public.amend_order_add_custom_item(
  uuid, text, integer, integer, text, integer, integer
) to authenticated;
