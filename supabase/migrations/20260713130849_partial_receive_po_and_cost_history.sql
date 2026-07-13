-- Wave H: per-line partial GRN + unit-cost history on stock movements.

-- Record the unit cost on each movement so purchases form a price history.
alter table public.stock_movements add column if not exists unit_cost_cents integer;

-- Receive specific quantities per PO line. _lines = [{po_item_id, qty}, ...].
-- Sets PO status to 'received' when every line is fully received, else 'partial'.
create or replace function public.receive_po_partial(_po_id uuid, _lines jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _branch uuid; _status public.po_status;
  _rec integer := 0; _l jsonb; _po_item uuid; _want numeric; _take numeric;
  _line record; _outstanding integer;
begin
  select tenant_id, branch_id, status into _tenant, _branch, _status
  from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'PO not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _status in ('received','cancelled') then
    raise exception 'PO is already closed' using errcode = '22023';
  end if;

  for _l in select * from jsonb_array_elements(coalesce(_lines, '[]'::jsonb)) loop
    _po_item := (_l->>'po_item_id')::uuid;
    _want := coalesce((_l->>'qty')::numeric, 0);
    if _want <= 0 then continue; end if;

    select id, inventory_item_id, qty_ordered, qty_received, unit_cost_cents
      into _line
    from public.po_items
    where id = _po_item and po_id = _po_id and inventory_item_id is not null;
    if _line.id is null then continue; end if;

    _take := least(_want, _line.qty_ordered - _line.qty_received);
    if _take <= 0 then continue; end if;

    update public.inventory_items
      set current_qty = current_qty + _take, cost_cents = _line.unit_cost_cents
    where id = _line.inventory_item_id and tenant_id = _tenant;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference, unit_cost_cents)
    values (_tenant, _branch, _line.inventory_item_id, 'purchase', _take, _po_id::text, _line.unit_cost_cents);

    update public.po_items set qty_received = qty_received + _take where id = _line.id;
    _rec := _rec + 1;
  end loop;

  select count(*) into _outstanding from public.po_items
    where po_id = _po_id and qty_ordered > qty_received;
  update public.purchase_orders
    set status = case when _outstanding = 0 then 'received' else 'partial' end
    where id = _po_id;

  return _rec;
end $function$;

-- Backfill the existing receive-all path to also stamp movement unit cost.
create or replace function public.receive_po(_po_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _branch uuid; _status public.po_status; _rec integer := 0; _line record;
begin
  select tenant_id, branch_id, status into _tenant, _branch, _status
  from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'PO not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _status = 'received' then return 0; end if;

  for _line in
    select id, inventory_item_id, qty_ordered, qty_received, unit_cost_cents
    from public.po_items
    where po_id = _po_id and qty_ordered > qty_received and inventory_item_id is not null
  loop
    update public.inventory_items
      set current_qty = current_qty + (_line.qty_ordered - _line.qty_received),
          cost_cents = _line.unit_cost_cents
    where id = _line.inventory_item_id;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference, unit_cost_cents)
    values (_tenant, _branch, _line.inventory_item_id, 'purchase',
            _line.qty_ordered - _line.qty_received, _po_id::text, _line.unit_cost_cents);

    update public.po_items set qty_received = qty_ordered where id = _line.id;
    _rec := _rec + 1;
  end loop;

  update public.purchase_orders set status = 'received' where id = _po_id;
  return _rec;
end $function$;

grant execute on function public.receive_po_partial(uuid, jsonb) to authenticated;
