-- ============================================================================
-- Void now REVERSES the theoretical ingredient deduction.
-- When an item was fired (a 'sale' stock_movement exists for it) and is voided,
-- add the recipe qty back to inventory and log a compensating 'adjustment'
-- movement, tagged `void:<order_item_id>` so it can only ever be restored once.
-- ============================================================================
create or replace function public.void_order_item(_order_item_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant  uuid;
  _order   uuid;
  _item    uuid;
  _qty     integer;
  _wasvoid boolean;
  _bill    uuid;
  _bill_status public.bill_status;
begin
  select tenant_id, order_id, item_id, qty, is_void
    into _tenant, _order, _item, _qty, _wasvoid
  from public.order_items where id = _order_item_id;
  if _tenant is null then
    raise exception 'order item not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'voids require a manager' using errcode = '42501';
  end if;
  if coalesce(trim(_reason), '') = '' then
    raise exception 'void reason is required' using errcode = '22023';
  end if;
  if _wasvoid then
    return; -- already void; idempotent, no double restore
  end if;

  update public.order_items
  set is_void = true, void_reason = _reason
  where id = _order_item_id and is_void = false;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'void', 'order_item', _order_item_id,
          jsonb_build_object('reason', _reason));

  -- Restore theoretical stock only if this line was fired (deducted) and not
  -- already restored.
  if _item is not null
     and exists (
       select 1 from public.stock_movements
       where tenant_id = _tenant and type = 'sale' and reference = _order_item_id::text
     )
     and not exists (
       select 1 from public.stock_movements
       where tenant_id = _tenant and reference = 'void:' || _order_item_id::text
     ) then

    update public.inventory_items i
    set current_qty = i.current_qty + (r.qty * _qty)
    from public.recipes r
    where r.menu_item_id = _item
      and r.tenant_id = _tenant
      and i.id = r.inventory_item_id;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select _tenant,
           (select branch_id from public.orders where id = _order),
           r.inventory_item_id, 'adjustment', (r.qty * _qty), 'void:' || _order_item_id::text
    from public.recipes r
    where r.menu_item_id = _item and r.tenant_id = _tenant;
  end if;

  select bill_id into _bill from public.orders where id = _order;
  if _bill is not null then
    select status into _bill_status from public.bills where id = _bill;
    if _bill_status <> 'paid' then
      perform public.recompute_bill(_bill);
    end if;
  end if;
end $$;

revoke execute on function public.void_order_item(uuid, text) from anon, public;
grant execute on function public.void_order_item(uuid, text) to authenticated;
