-- ============================================================================
-- Goods receipt (GRN): receive a purchase order → increment stock + log
-- 'purchase' movements + update last cost + set PO status. Trusted SQL,
-- owner/manager/inventory. Receives all outstanding qty (partial receive TODO).
-- ============================================================================

create or replace function public.receive_po(_po_id uuid)
returns integer                       -- number of lines received
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _branch uuid;
  _status public.po_status;
  _rec    integer := 0;
  _line   record;
begin
  select tenant_id, branch_id, status into _tenant, _branch, _status
  from public.purchase_orders where id = _po_id;
  if _tenant is null then
    raise exception 'PO not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _status = 'received' then
    return 0;
  end if;

  for _line in
    select id, inventory_item_id, qty_ordered, qty_received, unit_cost_cents
    from public.po_items
    where po_id = _po_id and qty_ordered > qty_received and inventory_item_id is not null
  loop
    -- Increment stock + record last purchase cost.
    update public.inventory_items
    set current_qty = current_qty + (_line.qty_ordered - _line.qty_received),
        cost_cents = _line.unit_cost_cents
    where id = _line.inventory_item_id;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    values (_tenant, _branch, _line.inventory_item_id, 'purchase',
            _line.qty_ordered - _line.qty_received, _po_id::text);

    update public.po_items set qty_received = qty_ordered where id = _line.id;
    _rec := _rec + 1;
  end loop;

  update public.purchase_orders set status = 'received' where id = _po_id;
  return _rec;
end $$;

revoke execute on function public.receive_po(uuid) from anon, public;
grant execute on function public.receive_po(uuid) to authenticated;
