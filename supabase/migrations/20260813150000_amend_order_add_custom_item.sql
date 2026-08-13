-- ============================================================================
-- amend_order_add_custom_item — one trusted implementation of "add an off-menu
-- line to an existing order", called by BOTH clients.
--
-- Why this exists: the CREATE path has accepted custom lines in trusted SQL
-- since 20260720090000 (`place_staff_order`, via `custom_name`), but the AMEND
-- path lived only in `addCustomItem()` in `app/(app)/pos/actions.ts`, which
-- inserts straight into `order_items` behind a `requireRole(...)` call.
--
-- A role check inside a server action is not a guard. RLS on `order_items` is
-- tenant-scoped only, so anyone holding the publishable key and a session for
-- this tenant could insert the same row through PostgREST — naming their own
-- price — without going near that action. The same reasoning produced
-- `amend_order_add_item` (20260727090000); this closes the last hole beside it.
--
-- Mobile is the trigger: the Flutter app cannot call a server action, and
-- reimplementing the insert in Dart would make a third place that decides what
-- a line costs.
--
-- Rules lifted verbatim from `place_staff_order`'s custom branch, so a custom
-- line created with the order and one added afterwards are the same row:
--
--   * `item_id` stays null, so a custom line can never impersonate a menu
--     item's price, and `fire_order`'s coalesce(station_id, nil) grouping puts
--     it on the expo ticket rather than dropping it.
--   * The price is the one client-supplied figure in the system — there is no
--     server-side truth for "birthday cake plating charge" — so it is clamped
--     and audited as a `custom_price` event.
--   * No stock is deducted: there is no recipe behind it.
-- ============================================================================

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

  if _status in ('billed', 'closed', 'cancelled') then
    raise exception 'order is % and cannot be amended', _status using errcode = '22023';
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
