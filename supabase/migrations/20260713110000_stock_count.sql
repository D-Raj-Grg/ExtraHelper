-- ============================================================================
-- Stock counts → variance → reconcile. The tables (stock_counts,
-- stock_count_items with a generated `variance`) already exist; this wires the
-- lifecycle: snapshot theoretical qty, let staff enter actuals, then post —
-- reconciling on-hand to counted and logging a 'count' stock movement per delta.
-- ============================================================================

alter table public.stock_counts
  add column if not exists posted_at timestamptz;

-- Open a new count and snapshot current on-hand as theoretical (+ seed actual).
create or replace function public.start_stock_count(_tenant uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _id uuid;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'inventory role required' using errcode = '42501';
  end if;
  insert into public.stock_counts (tenant_id, counted_by) values (_tenant, auth.uid())
  returning id into _id;
  insert into public.stock_count_items (tenant_id, stock_count_id, inventory_item_id, theoretical_qty, actual_qty)
  select _tenant, _id, i.id, i.current_qty, i.current_qty
  from public.inventory_items i where i.tenant_id = _tenant;
  return _id;
end $$;

-- Post a count: reconcile on-hand to actual for every changed line, once.
create or replace function public.post_stock_count(_count_id uuid)
returns integer language plpgsql security definer set search_path = public
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
  return _n;
end $$;

revoke execute on function public.start_stock_count(uuid) from anon, public;
revoke execute on function public.post_stock_count(uuid) from anon, public;
grant execute on function public.start_stock_count(uuid) to authenticated;
grant execute on function public.post_stock_count(uuid) to authenticated;
