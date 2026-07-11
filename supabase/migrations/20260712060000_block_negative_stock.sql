-- Optional per-tenant hard block: when on, firing an item that would drive any
-- ingredient below zero is rejected (the whole fire rolls back). Default off —
-- negatives are otherwise still allowed and surfaced by the oversold badge.
alter table public.tenant_settings
  add column if not exists block_negative_stock boolean not null default false;

create or replace function public.trg_deduct_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _block boolean;
begin
  if new.status = 'in_kitchen'
     and (old.status is distinct from 'in_kitchen')
     and new.is_void = false
     and new.item_id is not null then

    select block_negative_stock into _block from public.tenant_settings where tenant_id = new.tenant_id;

    if coalesce(_block, false) then
      if exists (
        select 1 from public.inventory_items i
        join public.recipes r on r.inventory_item_id = i.id
        where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id
          and i.current_qty - (r.qty * new.qty) < 0
      ) then
        raise exception 'Insufficient ingredient stock to fire "%"', new.name_snapshot
          using errcode = '23514';
      end if;
    end if;

    update public.inventory_items i
    set current_qty = i.current_qty - (r.qty * new.qty)
    from public.recipes r
    where r.menu_item_id = new.item_id
      and r.tenant_id = new.tenant_id
      and i.id = r.inventory_item_id;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select new.tenant_id,
           (select branch_id from public.orders where id = new.order_id),
           r.inventory_item_id, 'sale', -(r.qty * new.qty), new.id::text
    from public.recipes r
    where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id;
  end if;
  return new;
end $$;
