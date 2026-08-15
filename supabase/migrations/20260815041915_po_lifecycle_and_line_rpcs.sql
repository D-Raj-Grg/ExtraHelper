-- ============================================================================
-- Purchase order lifecycle and line editing.
--
-- Before this, a purchase order could only be created and received. There was
-- no way to fix a typo, remove a wrong line, cancel an order that never came,
-- delete an empty draft, or correct a receipt — and `sent` and `cancelled` were
-- rendered statuses that nothing could ever set.
--
-- These are RPCs rather than narrowed RLS because the rules are row-state
-- invariants a policy cannot express: "only while the parent is a draft",
-- "never let a client write qty_received", "re-derive the order status from
-- what is outstanding".
-- ============================================================================

create or replace function public.assert_may_edit_purchasing(_tenant uuid)
returns void language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant and status = 'active') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'purchasing.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

create or replace function public.assert_may_delete_purchasing(_tenant uuid)
returns void language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant and status = 'active') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'purchasing.delete') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.assert_may_edit_purchasing(uuid) from anon, public, authenticated;
revoke execute on function public.assert_may_delete_purchasing(uuid) from anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- An RPC rather than a direct insert for one reason the old action got wrong:
-- branch_id was never set, and record_supplier_payment reads its branch from
-- the order, so every cash payout was stamped with no branch.
create or replace function public.create_po(_tenant uuid, _supplier_id uuid default null)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare _branch uuid; _id uuid;
begin
  perform public.assert_may_edit_purchasing(_tenant);
  if _supplier_id is not null then
    if not exists (select 1 from public.suppliers where id = _supplier_id and tenant_id = _tenant) then
      raise exception 'supplier does not belong to this restaurant' using errcode = '42501';
    end if;
    if exists (select 1 from public.suppliers where id = _supplier_id and archived_at is not null) then
      raise exception 'that supplier is archived — restore them first' using errcode = '22023';
    end if;
  end if;
  select id into _branch from public.branches
   where tenant_id = _tenant and is_default order by created_at limit 1;

  insert into public.purchase_orders (tenant_id, branch_id, supplier_id, status)
  values (_tenant, _branch, _supplier_id, 'draft')
  returning id into _id;
  return _id;
end $$;

create or replace function public.set_po_supplier(_po_id uuid, _supplier_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status;
begin
  select tenant_id, status into _tenant, _status from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'the supplier can only change while the order is a draft' using errcode = '22023';
  end if;
  if _supplier_id is not null and not exists (
    select 1 from public.suppliers where id = _supplier_id and tenant_id = _tenant) then
    raise exception 'supplier does not belong to this restaurant' using errcode = '42501';
  end if;
  update public.purchase_orders set supplier_id = _supplier_id where id = _po_id;
end $$;

-- 'sent' was a rendered status nothing could ever set, yet it is already
-- load-bearing in SQL: create_draft_po_from_reorder treats draft/sent/partial
-- as "open" when deciding not to re-draft a line. Sending is also the honest
-- boundary that freezes the lines.
create or replace function public.send_po(_po_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _supplier uuid; _lines int;
begin
  select tenant_id, status, supplier_id into _tenant, _status, _supplier
  from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'only a draft can be sent' using errcode = '22023';
  end if;
  if _supplier is null then
    raise exception 'pick a supplier before sending' using errcode = '22023';
  end if;
  select count(*) into _lines from public.po_items where po_id = _po_id;
  if _lines = 0 then
    raise exception 'add at least one line before sending' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'sent' where id = _po_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'po_sent', 'purchase_order', _po_id, '{}'::jsonb);
end $$;

create or replace function public.reopen_po(_po_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status;
begin
  select tenant_id, status into _tenant, _status from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'sent' then
    raise exception 'only a sent order can be reopened' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'draft' where id = _po_id;
end $$;

-- Cancelling a PO that has received stock would drop its value out of
-- supplier_balances (which excludes cancelled) — the money owed vanishes while
-- the goods stay on the shelf. Refuse, and point at the correction instead.
create or replace function public.cancel_po(_po_id uuid, _reason text default null)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _recv numeric;
begin
  select tenant_id, status into _tenant, _status from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  select coalesce(sum(qty_received), 0) into _recv from public.po_items where po_id = _po_id;
  if _recv > 0 then
    raise exception 'stock has already been received on this order — correct the receipt first'
      using errcode = '22023';
  end if;
  if _status not in ('draft', 'sent') then
    raise exception 'only a draft or sent order can be cancelled' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'cancelled' where id = _po_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'po_cancelled', 'purchase_order', _po_id,
          jsonb_build_object('reason', nullif(btrim(coalesce(_reason,'')), '')));
end $$;

-- Deleting is only ever right for an order that was never really an order.
-- Anything received leaves stock_movements rows whose `reference` is plain
-- text, not an FK — they would survive as orphans pointing at a dead id while
-- current_qty keeps the stock forever.
create or replace function public.delete_po(_po_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _recv numeric; _pays int;
begin
  select tenant_id, status into _tenant, _status from public.purchase_orders where id = _po_id;
  if _tenant is null then return; end if;   -- deleting twice is not an error
  perform public.assert_may_delete_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'a sent order can only be cancelled, not deleted' using errcode = '22023';
  end if;
  select coalesce(sum(qty_received), 0) into _recv from public.po_items where po_id = _po_id;
  if _recv > 0 then
    raise exception 'stock has already been received on this order' using errcode = '22023';
  end if;
  select count(*) into _pays from public.supplier_payments where po_id = _po_id and voided_at is null;
  if _pays > 0 then
    raise exception 'a payment is recorded against this order' using errcode = '22023';
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'po_deleted', 'purchase_order', _po_id, '{}'::jsonb);
  delete from public.purchase_orders where id = _po_id;   -- po_items cascades
end $$;

-- ---------------------------------------------------------------------------
-- Lines
-- ---------------------------------------------------------------------------

-- Upsert, not insert: adding the same ingredient twice is a re-quote or a
-- correction, never a second row.
create or replace function public.add_po_line(
  _po_id uuid, _inventory_item_id uuid, _qty numeric, _unit_cost_cents integer
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _id uuid;
begin
  select tenant_id, status into _tenant, _status from public.purchase_orders where id = _po_id;
  if _tenant is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'lines can only change while the order is a draft' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_items
                 where id = _inventory_item_id and tenant_id = _tenant) then
    raise exception 'ingredient does not belong to this restaurant' using errcode = '42501';
  end if;
  if _qty is null or _qty <= 0 then
    raise exception 'quantity must be more than zero' using errcode = '22023';
  end if;
  if coalesce(_unit_cost_cents, 0) < 0 then
    raise exception 'unit cost cannot be negative' using errcode = '22023';
  end if;

  insert into public.po_items (tenant_id, po_id, inventory_item_id, qty_ordered, unit_cost_cents)
  values (_tenant, _po_id, _inventory_item_id, _qty, coalesce(_unit_cost_cents, 0))
  on conflict (po_id, inventory_item_id) where inventory_item_id is not null
  do update set qty_ordered = public.po_items.qty_ordered + excluded.qty_ordered,
                unit_cost_cents = excluded.unit_cost_cents
  returning id into _id;
  return _id;
end $$;

create or replace function public.update_po_line(
  _line_id uuid, _qty numeric, _unit_cost_cents integer
) returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _recv numeric;
begin
  select pi.tenant_id, po.status, pi.qty_received into _tenant, _status, _recv
  from public.po_items pi join public.purchase_orders po on po.id = pi.po_id
  where pi.id = _line_id;
  if _tenant is null then raise exception 'line not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'lines can only change while the order is a draft' using errcode = '22023';
  end if;
  if _qty is null or _qty <= 0 then
    raise exception 'quantity must be more than zero' using errcode = '22023';
  end if;
  if _qty < _recv then
    raise exception 'that is less than what has already been received' using errcode = '22023';
  end if;
  if coalesce(_unit_cost_cents, 0) < 0 then
    raise exception 'unit cost cannot be negative' using errcode = '22023';
  end if;
  update public.po_items
  set qty_ordered = _qty, unit_cost_cents = coalesce(_unit_cost_cents, 0)
  where id = _line_id;
end $$;

create or replace function public.delete_po_line(_line_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _status public.po_status; _recv numeric;
begin
  select pi.tenant_id, po.status, pi.qty_received into _tenant, _status, _recv
  from public.po_items pi join public.purchase_orders po on po.id = pi.po_id
  where pi.id = _line_id;
  if _tenant is null then return; end if;
  perform public.assert_may_edit_purchasing(_tenant);
  if _status <> 'draft' then
    raise exception 'lines can only change while the order is a draft' using errcode = '22023';
  end if;
  if _recv > 0 then
    raise exception 'stock has already been received on this line' using errcode = '22023';
  end if;
  delete from public.po_items where id = _line_id;
end $$;

-- ---------------------------------------------------------------------------
-- Correcting a receipt
-- ---------------------------------------------------------------------------

/**
 * Correction, not undo.
 *
 * Writes a compensating 'adjustment' movement carrying the delta and keeps the
 * original 'purchase' movement untouched — the shelf was wrong for a period of
 * time and the history should say so. `reference` uses the established
 * 'po-correct:<id>' shape so the correction stays tied to its purchase.
 *
 * Does NOT restore a previous cost_cents. Receiving overwrote last-known cost
 * and the prior value is not stored anywhere; reconstructing it would be a
 * guess presented as a fact. Passing a new cost re-stamps it explicitly.
 *
 * May drive current_qty negative. "Oversold" is a state the stock screen
 * already renders, and refusing would strand a receipt booked against the
 * wrong item with no way out.
 */
create or replace function public.correct_po_receipt(
  _line_id uuid, _new_qty_received numeric, _new_unit_cost_cents integer, _reason text
) returns void language plpgsql security definer set search_path = 'public' as $$
declare
  _tenant uuid; _branch uuid; _po uuid; _item uuid;
  _old_qty numeric; _old_cost integer; _delta numeric; _outstanding numeric;
begin
  select pi.tenant_id, po.branch_id, po.id, pi.inventory_item_id, pi.qty_received, pi.unit_cost_cents
    into _tenant, _branch, _po, _item, _old_qty, _old_cost
  from public.po_items pi join public.purchase_orders po on po.id = pi.po_id
  where pi.id = _line_id;
  if _tenant is null then raise exception 'line not found' using errcode = 'P0002'; end if;

  -- Reversing stock and money is the same class of act as deleting a supplier.
  perform public.assert_may_delete_purchasing(_tenant);

  if coalesce(btrim(_reason), '') = '' then
    raise exception 'say what went wrong — a correction without a reason cannot be audited'
      using errcode = '22023';
  end if;
  if _new_qty_received is null or _new_qty_received < 0 then
    raise exception 'received quantity cannot be negative' using errcode = '22023';
  end if;
  if _item is null then
    raise exception 'this line has no ingredient to correct' using errcode = '22023';
  end if;

  _delta := _new_qty_received - _old_qty;

  if _delta <> 0 then
    update public.inventory_items
      set current_qty = current_qty + _delta
    where id = _item and tenant_id = _tenant;

    insert into public.stock_movements
      (tenant_id, branch_id, inventory_item_id, type, qty, reference, unit_cost_cents)
    values (_tenant, _branch, _item, 'adjustment', _delta,
            'po-correct:' || _po::text, coalesce(_new_unit_cost_cents, _old_cost));
  end if;

  update public.po_items
  set qty_received = _new_qty_received,
      unit_cost_cents = coalesce(_new_unit_cost_cents, unit_cost_cents),
      qty_ordered = greatest(qty_ordered, _new_qty_received)
  where id = _line_id;

  if _new_unit_cost_cents is not null then
    update public.inventory_items set cost_cents = _new_unit_cost_cents
    where id = _item and tenant_id = _tenant;
  end if;

  -- Re-derive the order's status from what is now outstanding.
  select coalesce(sum(qty_ordered - qty_received), 0) into _outstanding
  from public.po_items where po_id = _po;
  update public.purchase_orders
  set status = case
        when _outstanding <= 0 then 'received'::public.po_status
        when exists (select 1 from public.po_items where po_id = _po and qty_received > 0)
          then 'partial'::public.po_status
        else 'draft'::public.po_status end
  where id = _po and status <> 'cancelled';

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'po_receipt_corrected', 'purchase_order', _po,
          jsonb_build_object('line_id', _line_id, 'from_qty', _old_qty,
                             'to_qty', _new_qty_received, 'delta', _delta,
                             'reason', btrim(_reason)));
end $$;

revoke execute on function public.create_po(uuid, uuid) from anon, public;
grant  execute on function public.create_po(uuid, uuid) to authenticated;
revoke execute on function public.set_po_supplier(uuid, uuid) from anon, public;
grant  execute on function public.set_po_supplier(uuid, uuid) to authenticated;
revoke execute on function public.send_po(uuid) from anon, public;
grant  execute on function public.send_po(uuid) to authenticated;
revoke execute on function public.reopen_po(uuid) from anon, public;
grant  execute on function public.reopen_po(uuid) to authenticated;
revoke execute on function public.cancel_po(uuid, text) from anon, public;
grant  execute on function public.cancel_po(uuid, text) to authenticated;
revoke execute on function public.delete_po(uuid) from anon, public;
grant  execute on function public.delete_po(uuid) to authenticated;
revoke execute on function public.add_po_line(uuid, uuid, numeric, integer) from anon, public;
grant  execute on function public.add_po_line(uuid, uuid, numeric, integer) to authenticated;
revoke execute on function public.update_po_line(uuid, numeric, integer) from anon, public;
grant  execute on function public.update_po_line(uuid, numeric, integer) to authenticated;
revoke execute on function public.delete_po_line(uuid) from anon, public;
grant  execute on function public.delete_po_line(uuid) to authenticated;
revoke execute on function public.correct_po_receipt(uuid, numeric, integer, text) from anon, public;
grant  execute on function public.correct_po_receipt(uuid, numeric, integer, text) to authenticated;
