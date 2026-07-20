-- ============================================================================
-- Per-dish food cost. report_inventory is per-INGREDIENT (COGS/valuation); this
-- is per-DISH: plate cost (Σ recipe.qty × ingredient cost) vs the menu sale
-- price → food-cost % and margin, so a manager sees which dishes bleed. Uses the
-- base recipe cost (variant portions scale consumption, not the headline plate
-- cost). security invoker + reports.view gate, mirroring report_inventory.
-- ============================================================================

create or replace function public.report_dish_food_cost(_tenant uuid)
returns table (
  menu_item_id     uuid,
  name             text,
  sale_price_cents integer,
  plate_cost_cents bigint,
  food_cost_pct    numeric,
  margin_cents     bigint,
  ingredient_count bigint
)
language sql stable security invoker set search_path = public
as $$
  select mi.id, mi.name, mi.base_price_cents,
         coalesce(round(sum(r.qty * ii.cost_cents)), 0)::bigint as plate_cost,
         case when mi.base_price_cents > 0
              then round(coalesce(sum(r.qty * ii.cost_cents), 0) / mi.base_price_cents * 100, 1)
              else null end as food_cost_pct,
         (mi.base_price_cents - coalesce(round(sum(r.qty * ii.cost_cents)), 0))::bigint as margin,
         count(r.id) as ingredient_count
  from public.menu_items mi
  left join public.recipes r on r.menu_item_id = mi.id and r.tenant_id = _tenant
  left join public.inventory_items ii on ii.id = r.inventory_item_id
  where mi.tenant_id = _tenant and public.has_permission(_tenant, 'reports.view')
  group by mi.id
  order by food_cost_pct desc nulls last;
$$;

-- Security invoker + has_permission gate + RLS already block anon, but lock the
-- grant to authenticated to match the house convention (and clear the advisor).
revoke execute on function public.report_dish_food_cost(uuid) from anon, public;
grant execute on function public.report_dish_food_cost(uuid) to authenticated;
