-- ============================================================================
-- Inventory ops: close the unguarded stock write, give the count line an RPC,
-- and let an item carry a barcode. Shared by the web store room and the Flutter
-- app (mobile Milestone J).
--
-- **`adjust_inventory` had no authorization at all.** It was `security invoker`
-- with no `has_tenant_role` and no `has_permission` in its body, and RLS on
-- `inventory_items` / `stock_movements` is tenant-scoped only — so it stopped
-- nobody who was already in the restaurant. The only guard was
-- `requireRole("owner","manager","inventory")` in the TypeScript action, whose
-- comment claimed "RLS + role enforced inside". It was not. Any member — waiter,
-- cook — could write stock up or down, or log a wastage write-off, through the
-- API directly. Nothing wrote an `audit_logs` row either, and `stock_movements`
-- carries no actor column, so *who* moved stock was recorded nowhere.
--
-- Same shape as the 86 / table-state hole closed on 2026-07-27 and the revenue
-- ones closed on 2026-07-30: a role check inside a server action is not a guard.
-- ============================================================================

-- --- 1. adjust_inventory: guard, audit, and the definer trap ---------------
--
-- Gated on `inventory.edit`, whose holders are exactly the old INV_ROLES
-- (owner, manager, inventory) — so nothing regresses, and the rule stays in the
-- shared catalog instead of being a role list copied into a third place.
create or replace function public.adjust_inventory(
  _item   uuid,
  _delta  numeric,
  _type   public.stock_movement_type,
  _reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _branch uuid; _name text; _new numeric;
begin
  if _delta = 0 then
    raise exception 'adjustment must be non-zero' using errcode = '22023';
  end if;

  -- Derive the tenant BEFORE touching the row.
  --
  -- The previous version got the tenant out of the update itself
  -- (`update … returning tenant_id into _tenant`). That was safe only because
  -- the function was SECURITY INVOKER and RLS fenced the update. It is now
  -- DEFINER, so the same shape would write another tenant's stock and only then
  -- ask whether the caller was allowed to. Select, guard, then update.
  select tenant_id, branch_id, name
    into _tenant, _branch, _name
    from public.inventory_items
   where id = _item;

  if _tenant is null then
    raise exception 'inventory item not found' using errcode = 'P0002';
  end if;

  if not public.has_permission(_tenant, 'inventory.edit') then
    raise exception 'not authorized to adjust stock' using errcode = '42501';
  end if;

  update public.inventory_items
     set current_qty = current_qty + _delta
   where id = _item
  returning current_qty into _new;

  insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
  values (_tenant, _branch, _item, _type, _delta, nullif(_reason, ''));

  -- The only attribution that will exist: `stock_movements` has no actor column.
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _tenant, auth.uid(),
    case when _type = 'wastage' then 'stock_waste' else 'stock_adjust' end,
    'inventory_item', _item,
    jsonb_build_object(
      'name',    _name,
      'delta',   _delta,
      'type',    _type,
      'reason',  nullif(_reason, ''),
      'new_qty', _new
    )
  );

  return _new;
end $$;

-- Same arity, so the existing grants carry over — but `public` held EXECUTE by
-- default from the original migration and nothing ever revoked it. Fix that
-- while we are here; it matters more now the function is DEFINER.
revoke execute on function public.adjust_inventory(uuid, numeric, public.stock_movement_type, text) from public, anon;
grant  execute on function public.adjust_inventory(uuid, numeric, public.stock_movement_type, text) to authenticated;

-- --- 2. set_stock_count_actual --------------------------------------------
--
-- The web wrote `stock_count_items.actual_qty` straight through PostgREST,
-- where RLS is tenant-only — so any member could edit the numbers a manager
-- then posts. This makes recording a counted quantity one guarded call, which
-- is also what lets the phone queue it: the value is **absolute**, so a replay
-- is last-write-wins and converges. (A delta could not be queued safely —
-- that is why `adjust_inventory` stays online-only on mobile.)
create or replace function public.set_stock_count_actual(
  _count_item_id uuid,
  _actual        numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _theoretical numeric; _posted timestamptz; _variance numeric;
begin
  -- Note: `variance` is a GENERATED column (`actual_qty - theoretical_qty`).
  -- Writing to it raises 428C9, so this only ever sets `actual_qty` and reads
  -- the variance back out. The first version of this function tried to write
  -- both and failed on the very first count.
  if _actual is null or _actual < 0 then
    raise exception 'a counted quantity must be zero or more' using errcode = '22023';
  end if;

  select sci.tenant_id, sci.theoretical_qty, sc.posted_at
    into _tenant, _theoretical, _posted
    from public.stock_count_items sci
    join public.stock_counts sc on sc.id = sci.stock_count_id
   where sci.id = _count_item_id;

  if _tenant is null then
    raise exception 'count line not found' using errcode = 'P0002';
  end if;

  if not public.has_permission(_tenant, 'inventory.edit') then
    raise exception 'not authorized to record a count' using errcode = '42501';
  end if;

  -- A posted count is history. Silently rewriting it would change what the
  -- stock movements were justified by.
  if _posted is not null then
    raise exception 'this count was already posted' using errcode = '22023';
  end if;

  update public.stock_count_items
     set actual_qty = _actual
   where id = _count_item_id
  returning variance into _variance;

  -- Returned so the caller renders the same number the database holds, rather
  -- than a second subtraction done in TypeScript and a third in Dart.
  return _variance;
end $$;

revoke execute on function public.set_stock_count_actual(uuid, numeric) from public, anon;
grant  execute on function public.set_stock_count_actual(uuid, numeric) to authenticated;

-- --- 3. Posting a count is auditable too ----------------------------------
--
-- Unchanged except for the audit row: posting is what actually writes shrinkage
-- into stock, and until now it left no trace of who did it.
create or replace function public.post_stock_count(_count_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _posted timestamptz; _n integer := 0; _rec record; _delta numeric;
begin
  select tenant_id, posted_at into _tenant, _posted from public.stock_counts where id = _count_id;
  if _tenant is null then raise exception 'count not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'inventory role required' using errcode = '42501';
  end if;
  if _posted is not null then raise exception 'count already posted' using errcode = '22023'; end if;

  for _rec in
    select sci.inventory_item_id as item, sci.actual_qty, ii.current_qty, ii.branch_id
    from public.stock_count_items sci
    join public.inventory_items ii on ii.id = sci.inventory_item_id
    where sci.stock_count_id = _count_id and sci.inventory_item_id is not null
  loop
    _delta := _rec.actual_qty - _rec.current_qty;
    if _delta <> 0 then
      update public.inventory_items set current_qty = _rec.actual_qty where id = _rec.item;
      insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
      values (_tenant, _rec.branch_id, _rec.item, 'count', _delta, 'count:' || _count_id::text);
      _n := _n + 1;
    end if;
  end loop;

  update public.stock_counts set posted_at = now() where id = _count_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _tenant, auth.uid(), 'stock_count_post', 'stock_count', _count_id,
    jsonb_build_object('lines_adjusted', _n)
  );

  return _n;
end $$;

revoke execute on function public.post_stock_count(uuid) from public, anon;
grant  execute on function public.post_stock_count(uuid) to authenticated;

-- --- 4. Barcodes -----------------------------------------------------------
--
-- Nullable, because most items will never carry one and "unmarked" is a real
-- state. Unique **per tenant** and only where set: two restaurants may stock the
-- same supplier's product, and the many null rows must not collide with each
-- other.
alter table public.inventory_items add column if not exists barcode text;

create unique index if not exists inventory_items_tenant_barcode_uidx
  on public.inventory_items (tenant_id, barcode)
  where barcode is not null;

comment on column public.inventory_items.barcode is
  'Optional scannable code (EAN/UPC/QR). Unique per tenant where set; looked up by the mobile scanner.';
