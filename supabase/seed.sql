-- ============================================================================
-- Dev seed — a demo tenant with sample menu, stations, tables, inventory.
-- Idempotent (fixed UUIDs + on-conflict). Runs as a privileged role, so it
-- bypasses RLS. Attaches an owner membership to the first auth user found, so a
-- signed-in dev account can see the data. Safe to re-run.
--
-- Apply: `supabase db reset` (auto-runs this), or paste into the SQL editor.
-- Never run against a real tenant's project.
-- ============================================================================

do $$
declare
  t   uuid := 'd0000000-0000-0000-0000-000000000001';  -- demo tenant
  b   uuid := 'd0000000-0000-0000-0000-0000000000b1';  -- default branch
  s_grill uuid := 'd0000000-0000-0000-0000-0000000051a1';
  s_bar   uuid := 'd0000000-0000-0000-0000-0000000051a2';
  c_main  uuid := 'd0000000-0000-0000-0000-0000000c0001';
  c_drink uuid := 'd0000000-0000-0000-0000-0000000c0002';
  i_burger uuid := 'd0000000-0000-0000-0000-00000001de01';
  i_fries  uuid := 'd0000000-0000-0000-0000-00000001de02';
  i_cola   uuid := 'd0000000-0000-0000-0000-00000001de03';
  inv_bun  uuid := 'd0000000-0000-0000-0000-00000000b001';
  first_user uuid;
begin
  -- Tenant + settings + branch
  insert into public.tenants (id, name, slug, status)
  values (t, 'Demo Diner', 'demo-diner', 'active')
  on conflict (id) do nothing;

  insert into public.tenant_settings (tenant_id, currency, timezone, service_charge)
  values (t, 'USD', 'America/New_York', 10)
  on conflict (tenant_id) do nothing;

  insert into public.branches (id, tenant_id, name, is_default)
  values (b, t, 'Main', true)
  on conflict (id) do nothing;

  -- Attach owner membership to the first auth user, if any (dev convenience).
  select id into first_user from auth.users order by created_at limit 1;
  if first_user is not null then
    insert into public.user_tenants (user_id, tenant_id, role, branch_id)
    values (first_user, t, 'owner', b)
    on conflict (user_id, tenant_id) do nothing;
  end if;

  -- Kitchen stations
  insert into public.kitchen_stations (id, tenant_id, branch_id, name) values
    (s_grill, t, b, 'Grill'),
    (s_bar,   t, b, 'Bar')
  on conflict (id) do nothing;

  -- Menu categories
  insert into public.menu_categories (id, tenant_id, name, sort) values
    (c_main,  t, 'Mains', 0),
    (c_drink, t, 'Drinks', 1)
  on conflict (id) do nothing;

  -- Menu items
  insert into public.menu_items (id, tenant_id, category_id, name, base_price_cents) values
    (i_burger, t, c_main,  'Classic Burger', 1200),
    (i_fries,  t, c_main,  'Fries',          500),
    (i_cola,   t, c_drink, 'Cola',           300)
  on conflict (id) do nothing;

  -- Station routing (burger+fries → grill, cola → bar)
  insert into public.item_station_routes (tenant_id, item_id, station_id) values
    (t, i_burger, s_grill),
    (t, i_fries,  s_grill),
    (t, i_cola,   s_bar)
  on conflict (item_id, station_id) do nothing;

  -- Tables
  insert into public.restaurant_tables (tenant_id, branch_id, label, capacity, state)
  select t, b, 'T' || g, 4, 'free'
  from generate_series(1, 6) g
  on conflict do nothing;

  -- Inventory + recipe (burger consumes 1 bun)
  insert into public.inventory_items (id, tenant_id, branch_id, name, uom, reorder_level, current_qty, cost_cents)
  values (inv_bun, t, b, 'Burger Bun', 'unit', 20, 100, 25)
  on conflict (id) do nothing;

  insert into public.recipes (tenant_id, menu_item_id, inventory_item_id, qty)
  values (t, i_burger, inv_bun, 1)
  on conflict (menu_item_id, inventory_item_id) do nothing;
end $$;
