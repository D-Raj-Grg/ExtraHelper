-- ============================================================================
-- Atomic manual stock adjustment. Replaces the app's read-modify-write (which
-- could lose concurrent adjusts) with a single `current_qty = current_qty +
-- delta` update + movement log. SECURITY INVOKER so RLS (tenant + role) applies.
-- ============================================================================
create or replace function public.adjust_inventory(
  _item uuid,
  _delta numeric,
  _type public.stock_movement_type,
  _reason text
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  _tenant uuid;
  _branch uuid;
  _new    numeric;
begin
  if _delta = 0 then
    raise exception 'adjustment must be non-zero' using errcode = '22023';
  end if;

  update public.inventory_items
  set current_qty = current_qty + _delta
  where id = _item
  returning tenant_id, branch_id, current_qty into _tenant, _branch, _new;

  if _tenant is null then
    raise exception 'inventory item not found' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
  values (_tenant, _branch, _item, _type, _delta, nullif(_reason, ''));

  return _new;
end $$;

revoke execute on function public.adjust_inventory(uuid, numeric, public.stock_movement_type, text) from anon, public;
grant execute on function public.adjust_inventory(uuid, numeric, public.stock_movement_type, text) to authenticated;
