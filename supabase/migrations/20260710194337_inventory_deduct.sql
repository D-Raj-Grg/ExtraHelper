-- ============================================================================
-- Auto-deduct ingredient stock on sale (theoretical usage, inventory rule).
-- When an order item transitions to 'in_kitchen' (fired), deduct each recipe
-- ingredient from inventory_items and log a 'sale' stock_movement. Fires once
-- per item (on the status transition), so it's not double-counted on re-fire.
-- ============================================================================

create or replace function public.trg_deduct_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_kitchen'
     and (old.status is distinct from 'in_kitchen')
     and new.is_void = false
     and new.item_id is not null then

    -- Deduct theoretical usage: recipe qty × ordered qty.
    update public.inventory_items i
    set current_qty = i.current_qty - (r.qty * new.qty)
    from public.recipes r
    where r.menu_item_id = new.item_id
      and r.tenant_id = new.tenant_id
      and i.id = r.inventory_item_id;

    -- Log movements (negative = stock out), referencing the order item.
    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select new.tenant_id,
           (select branch_id from public.orders where id = new.order_id),
           r.inventory_item_id, 'sale', -(r.qty * new.qty), new.id::text
    from public.recipes r
    where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_order_item_deduct on public.order_items;
create trigger trg_order_item_deduct
  after update on public.order_items
  for each row execute function public.trg_deduct_stock();
