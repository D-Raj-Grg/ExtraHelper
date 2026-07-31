-- ============================================================================
-- amend_order_add_item — one trusted implementation of "add a line to an
-- existing order", called by BOTH clients.
--
-- Why this exists: the create path has been trusted SQL since
-- 20260716090000 (place_staff_order), but the AMEND path lived only in the
-- TypeScript server action addItem() (app/(app)/pos/actions.ts). The Flutter
-- app can't call a server action, and porting that logic to Dart would make
-- three implementations of the same pricing rules. Pricing that exists in more
-- than one place drifts, and drift here means the till total and the kitchen
-- ticket disagree.
--
-- Three defects in the TS version are fixed by construction here:
--
--  1. ATOMICITY. addItem() inserted order_items, then order_item_modifiers, in
--     two round-trips. A failure between them left a line whose
--     unit_price_cents included modifiers that have no order_item_modifiers
--     rows — the till charged for cheese the kitchen ticket never mentions.
--     One plpgsql function is one transaction.
--  2. ORDER-TENANT CHECK. addItem() never verified the order belonged to the
--     active tenant; it leaned entirely on RLS. Every other query got an
--     explicit .eq("tenant_id") in the defense-in-depth sweep. This is
--     SECURITY DEFINER, so RLS is bypassed and the check is mandatory.
--  3. DUPLICATED MODIFIER-LINK VALIDATION. 20260720090000 added the
--     item_modifiers check to place_staff_order and to addItem() separately,
--     noting "the two must agree to the cent". Now there is one.
--
-- Pricing is lifted verbatim from place_staff_order so the create and amend
-- paths produce identical unit_price_cents and name_snapshot for the same
-- input. Any change to one must be made to the other.
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

  -- A billed or closed order is settled; a cancelled one is not coming back.
  -- Adding to either produces a line nobody will cook or charge for.
  if _status in ('billed', 'closed', 'cancelled') then
    raise exception 'order is % and cannot be amended', _status using errcode = '22023';
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
