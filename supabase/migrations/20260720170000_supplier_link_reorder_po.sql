-- ============================================================================
-- Phase 3: link ingredients to a supplier and turn low stock into draft POs.
--   * inventory_items.supplier_id (nullable — "no supplier set" is a real state,
--     render nothing / pick via Select).
--   * create_draft_po_from_reorder — one click drafts a PO per supplier for every
--     ingredient at/below reorder, ordering up to par (mirrors the report's
--     reorder_qty so the numbers match). Skips items already on an open PO so a
--     second click doesn't duplicate lines.
-- ============================================================================

alter table public.inventory_items
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
create index if not exists idx_inventory_items_supplier on public.inventory_items(supplier_id);

create or replace function public.create_draft_po_from_reorder(_tenant uuid, _branch uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare _created integer := 0; _sup record; _po uuid; _lines integer;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;

  -- One draft per distinct supplier (null supplier = one "unassigned" draft).
  for _sup in
    select distinct supplier_id
    from public.inventory_items i
    where i.tenant_id = _tenant
      and i.current_qty <= i.reorder_level
      and greatest(0, coalesce(nullif(i.par_level, 0), i.reorder_level) - i.current_qty) > 0
      and not exists (
        select 1 from public.po_items pi
        join public.purchase_orders po on po.id = pi.po_id
        where po.tenant_id = _tenant and po.status in ('draft', 'sent', 'partial')
          and pi.inventory_item_id = i.id
      )
  loop
    insert into public.purchase_orders (tenant_id, branch_id, supplier_id, status)
    values (_tenant, _branch, _sup.supplier_id, 'draft')
    returning id into _po;

    insert into public.po_items (tenant_id, po_id, inventory_item_id, qty_ordered, unit_cost_cents)
    select _tenant, _po, i.id,
           greatest(0, coalesce(nullif(i.par_level, 0), i.reorder_level) - i.current_qty),
           i.cost_cents
    from public.inventory_items i
    where i.tenant_id = _tenant
      and i.supplier_id is not distinct from _sup.supplier_id
      and i.current_qty <= i.reorder_level
      and greatest(0, coalesce(nullif(i.par_level, 0), i.reorder_level) - i.current_qty) > 0
      and not exists (
        select 1 from public.po_items pi
        join public.purchase_orders po on po.id = pi.po_id
        where po.tenant_id = _tenant and po.status in ('draft', 'sent', 'partial')
          and pi.inventory_item_id = i.id
      );
    get diagnostics _lines = row_count;
    -- A supplier group could be fully covered by existing open POs → no lines.
    if _lines = 0 then
      delete from public.purchase_orders where id = _po;
    else
      _created := _created + 1;
    end if;
  end loop;

  return _created;
end $$;

revoke execute on function public.create_draft_po_from_reorder(uuid, uuid) from anon, public;
grant execute on function public.create_draft_po_from_reorder(uuid, uuid) to authenticated;
