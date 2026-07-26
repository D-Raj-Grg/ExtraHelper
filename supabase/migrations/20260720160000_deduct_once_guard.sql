-- ============================================================================
-- Deduct-once-ever guard. trg_deduct_stock fired on the transition INTO
-- 'in_kitchen'. That is unreachable more than once today (order_items only ever
-- go draft/placed → in_kitchen and never back), but it was a latent trap: any
-- future path that reset a line's status and re-fired it — a recall, a
-- re-expedite — would deduct a second time. We now also require that NO 'sale'
-- movement already exists for this order_item, mirroring the void's idempotency.
-- A line deducts at most once, forever, regardless of status ping-pong.
-- ============================================================================

create or replace function public.trg_deduct_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _block  boolean;
  _scale  numeric := 1;
  _branch uuid;
begin
  if new.status = 'in_kitchen'
     and (old.status is distinct from 'in_kitchen')
     and new.is_void = false
     and new.item_id is not null
     and not exists (
       select 1 from public.stock_movements
       where tenant_id = new.tenant_id and type = 'sale' and reference = new.id::text
     ) then

    if new.variant_id is not null then
      select coalesce(recipe_scale, 1) into _scale
      from public.item_variants where id = new.variant_id and tenant_id = new.tenant_id;
      _scale := coalesce(_scale, 1);
    end if;

    select branch_id into _branch from public.orders where id = new.order_id;

    select block_negative_stock into _block from public.tenant_settings where tenant_id = new.tenant_id;

    if coalesce(_block, false) then
      if exists (
        select 1
        from (
          select iid, sum(used) as used from (
            select r.inventory_item_id as iid, r.qty * _scale * new.qty as used
            from public.recipes r
            where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id
            union all
            select mi.inventory_item_id, mi.qty * oim.qty * new.qty
            from public.order_item_modifiers oim
            join public.modifier_ingredients mi
              on mi.modifier_id = oim.modifier_id and mi.tenant_id = new.tenant_id
            where oim.order_item_id = new.id and oim.tenant_id = new.tenant_id
          ) need group by iid
        ) a
        join public.inventory_items i on i.id = a.iid
        where i.current_qty - a.used < 0
      ) then
        raise exception 'Insufficient ingredient stock to fire "%"', new.name_snapshot
          using errcode = '23514';
      end if;
    end if;

    update public.inventory_items i
    set current_qty = i.current_qty - a.used
    from (
      select iid, sum(used) as used from (
        select r.inventory_item_id as iid, r.qty * _scale * new.qty as used
        from public.recipes r
        where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id
        union all
        select mi.inventory_item_id, mi.qty * oim.qty * new.qty
        from public.order_item_modifiers oim
        join public.modifier_ingredients mi
          on mi.modifier_id = oim.modifier_id and mi.tenant_id = new.tenant_id
        where oim.order_item_id = new.id and oim.tenant_id = new.tenant_id
      ) need group by iid
    ) a
    where i.id = a.iid;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select new.tenant_id, _branch, a.iid, 'sale', -a.used, new.id::text
    from (
      select iid, sum(used) as used from (
        select r.inventory_item_id as iid, r.qty * _scale * new.qty as used
        from public.recipes r
        where r.menu_item_id = new.item_id and r.tenant_id = new.tenant_id
        union all
        select mi.inventory_item_id, mi.qty * oim.qty * new.qty
        from public.order_item_modifiers oim
        join public.modifier_ingredients mi
          on mi.modifier_id = oim.modifier_id and mi.tenant_id = new.tenant_id
        where oim.order_item_id = new.id and oim.tenant_id = new.tenant_id
      ) need group by iid
    ) a;
  end if;
  return new;
end $$;
