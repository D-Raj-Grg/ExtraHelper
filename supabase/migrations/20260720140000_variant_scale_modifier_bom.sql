-- ============================================================================
-- Variant/modifier-aware stock consumption (Phase 2). Until now trg_deduct_stock
-- keyed only on menu_item_id, so a Half plate and a Full plate deducted the same
-- recipe and an "extra cheese" modifier deducted no cheese. Two additions:
--
--   1. item_variants.recipe_scale (Half = 0.5) — the base recipe is multiplied
--      by the sold variant's scale. default 1 → every existing variant keeps
--      today's exact behaviour.
--   2. modifier_ingredients — a mini-BOM per modifier, so a modifier deducts its
--      own ingredients on top of the dish's recipe.
--
-- The deduct trigger now aggregates base-recipe (scaled) + modifier ingredients
-- into ONE signed 'sale' movement per inventory item. The void is rewritten to
-- restore by NEGATING those recorded movements rather than recomputing the
-- recipe — so a recipe/scale/BOM edit between fire and void can't corrupt stock.
-- Both functions keep their signatures → create-or-replace, no regrant.
-- ============================================================================

alter table public.item_variants
  add column if not exists recipe_scale numeric not null default 1;
alter table public.item_variants drop constraint if exists item_variants_recipe_scale_pos;
alter table public.item_variants
  add constraint item_variants_recipe_scale_pos check (recipe_scale >= 0);

create table if not exists public.modifier_ingredients (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  modifier_id       uuid not null references public.modifiers(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  qty               numeric(12,3) not null default 0,
  created_at        timestamptz not null default now(),
  unique (modifier_id, inventory_item_id)
);
create index if not exists idx_modifier_ingredients_tenant on public.modifier_ingredients(tenant_id);
create index if not exists idx_modifier_ingredients_modifier on public.modifier_ingredients(modifier_id);
select public.apply_tenant_rls('public.modifier_ingredients');

-- ---------------------------------------------------------------------------
-- Deduct trigger — variant-scaled base recipe + modifier BOM, one movement/item.
-- ---------------------------------------------------------------------------
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
     and new.item_id is not null then

    -- Portion scale from the sold variant (Half = 0.5); no variant → 1.
    if new.variant_id is not null then
      select coalesce(recipe_scale, 1) into _scale
      from public.item_variants where id = new.variant_id and tenant_id = new.tenant_id;
      _scale := coalesce(_scale, 1);
    end if;

    select branch_id into _branch from public.orders where id = new.order_id;

    select block_negative_stock into _block from public.tenant_settings where tenant_id = new.tenant_id;

    -- Hard block: refuse the fire if any ingredient (scaled recipe + modifiers)
    -- would go negative. Same aggregation the deduction uses.
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

    -- Deduct (one aggregated total per ingredient).
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

    -- Log one signed 'sale' movement per ingredient — this is what the void
    -- reads to restore exactly what was taken.
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

-- ---------------------------------------------------------------------------
-- Void — restore by negating the recorded 'sale' movements (drift-proof).
-- Signature unchanged; permission gates + audit + bill recompute preserved.
-- ---------------------------------------------------------------------------
create or replace function public.void_order_item(_order_item_id uuid, _reason text)
returns void language plpgsql security definer set search_path = 'public'
as $function$
declare
  _tenant uuid; _order uuid; _item uuid; _qty integer; _wasvoid boolean;
  _bill uuid; _bill_status public.bill_status;
begin
  select tenant_id, order_id, item_id, qty, is_void
    into _tenant, _order, _item, _qty, _wasvoid
  from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'voids require a manager' using errcode = '42501'; end if;
  if not public.has_permission(_tenant, 'order.void') then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'void reason is required' using errcode = '22023'; end if;
  if _wasvoid then return; end if;

  update public.order_items set is_void = true, void_reason = _reason where id = _order_item_id and is_void = false;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'void', 'order_item', _order_item_id, jsonb_build_object('reason', _reason));

  -- Restore EXACTLY what was deducted by reversing the recorded 'sale' movements
  -- for this line. Reading movements (not recipes) is drift-proof: a recipe /
  -- variant-scale / modifier-BOM edit between fire and void can't corrupt stock.
  -- Idempotent via the 'void:<id>' guard.
  if exists (select 1 from public.stock_movements where tenant_id = _tenant and type = 'sale' and reference = _order_item_id::text)
     and not exists (select 1 from public.stock_movements where tenant_id = _tenant and reference = 'void:' || _order_item_id::text) then
    update public.inventory_items i
    set current_qty = i.current_qty - s.total   -- s.total is negative (sale), so this adds back
    from (
      select inventory_item_id, sum(qty) as total
      from public.stock_movements
      where tenant_id = _tenant and type = 'sale' and reference = _order_item_id::text
      group by inventory_item_id
    ) s
    where i.id = s.inventory_item_id;

    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select _tenant, (select branch_id from public.orders where id = _order), s.inventory_item_id, 'adjustment', -s.total, 'void:' || _order_item_id::text
    from (
      select inventory_item_id, sum(qty) as total
      from public.stock_movements
      where tenant_id = _tenant and type = 'sale' and reference = _order_item_id::text
      group by inventory_item_id
    ) s;
  end if;

  select bill_id into _bill from public.orders where id = _order;
  if _bill is not null then
    select status into _bill_status from public.bills where id = _bill;
    if _bill_status <> 'paid' then perform public.recompute_bill(_bill); end if;
  end if;
end $function$;
