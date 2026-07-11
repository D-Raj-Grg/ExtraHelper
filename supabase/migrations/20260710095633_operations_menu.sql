-- ============================================================================
-- Milestone 0 core schema (2/4) — Floors/Tables/Reservations, Menu, Stations.
-- Every table carries tenant_id (rule #1); RLS applied via apply_tenant_rls().
-- ============================================================================

do $$ begin
  create type public.table_state as enum
    ('free','occupied','reserved','bill_requested','cleaning');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reservation_status as enum
    ('pending','confirmed','seated','cancelled','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_type as enum ('dine_in','delivery','pickup','qr');
exception when duplicate_object then null; end $$;

-- --- Floors / tables / reservations -----------------------------------------
create table if not exists public.floors (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_floors_tenant on public.floors(tenant_id);

create table if not exists public.restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  floor_id    uuid references public.floors(id) on delete set null,
  label       text not null,
  capacity    integer not null default 2,
  shape       text not null default 'square',
  pos_x       numeric(8,2) not null default 0,
  pos_y       numeric(8,2) not null default 0,
  state       public.table_state not null default 'free',
  qr_token    uuid not null default gen_random_uuid(),
  current_order_id uuid,                    -- FK added in orders migration
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, qr_token)
);
create index if not exists idx_tables_tenant on public.restaurant_tables(tenant_id);
create trigger trg_tables_updated before update on public.restaurant_tables
  for each row execute function public.set_updated_at();

create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  table_id     uuid references public.restaurant_tables(id) on delete set null,
  customer_id  uuid,                         -- FK added in customers migration
  party_size   integer not null default 2,
  reserved_at  timestamptz not null,
  status       public.reservation_status not null default 'pending',
  deposit_cents integer not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_reservations_tenant on public.reservations(tenant_id, reserved_at);
create trigger trg_reservations_updated before update on public.reservations
  for each row execute function public.set_updated_at();

-- --- Kitchen stations --------------------------------------------------------
create table if not exists public.kitchen_stations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete cascade,
  name       text not null,                  -- grill / bar / tandoor / dessert
  created_at timestamptz not null default now()
);
create index if not exists idx_stations_tenant on public.kitchen_stations(tenant_id);

-- --- Menu --------------------------------------------------------------------
create table if not exists public.menu_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_menu_categories_tenant on public.menu_categories(tenant_id);

-- Multiple menus (dine-in vs delivery pricing, happy-hour) — PRD 2.8.
create table if not exists public.menus (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  order_type public.order_type,             -- null = applies to all
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_menus_tenant on public.menus(tenant_id);

create table if not exists public.menu_schedules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  menu_id     uuid not null references public.menus(id) on delete cascade,
  day_of_week smallint,                       -- 0-6, null = every day
  start_time  time not null,
  end_time    time not null
);
create index if not exists idx_menu_schedules_tenant on public.menu_schedules(tenant_id);

create table if not exists public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  category_id     uuid references public.menu_categories(id) on delete set null,
  name            text not null,
  description     text,
  base_price_cents integer not null default 0,
  tax_class       text,                        -- resolves to a tenant tax rule
  image_url       text,
  spice_level     smallint,
  allergens       jsonb not null default '[]',
  is_86           boolean not null default false,  -- out-of-stock toggle
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_menu_items_tenant on public.menu_items(tenant_id);
create trigger trg_menu_items_updated before update on public.menu_items
  for each row execute function public.set_updated_at();

-- Per-menu price override for an item (dine-in vs delivery, happy-hour).
create table if not exists public.menu_item_prices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  menu_id     uuid not null references public.menus(id) on delete cascade,
  item_id     uuid not null references public.menu_items(id) on delete cascade,
  price_cents integer not null,
  unique (menu_id, item_id)
);
create index if not exists idx_menu_item_prices_tenant on public.menu_item_prices(tenant_id);

create table if not exists public.item_variants (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  item_id           uuid not null references public.menu_items(id) on delete cascade,
  name              text not null,            -- Small / Large / Half
  price_delta_cents integer not null default 0
);
create index if not exists idx_item_variants_tenant on public.item_variants(tenant_id);

create table if not exists public.modifiers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,                  -- Extra cheese / No onion
  price_cents integer not null default 0
);
create index if not exists idx_modifiers_tenant on public.modifiers(tenant_id);

create table if not exists public.item_modifiers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  item_id     uuid not null references public.menu_items(id) on delete cascade,
  modifier_id uuid not null references public.modifiers(id) on delete cascade,
  is_default  boolean not null default false,
  max_qty     integer not null default 1,
  unique (item_id, modifier_id)
);
create index if not exists idx_item_modifiers_tenant on public.item_modifiers(tenant_id);

create table if not exists public.combos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  price_cents integer not null default 0,
  items       jsonb not null default '[]',    -- [{item_id, qty}]
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_combos_tenant on public.combos(tenant_id);

-- Which station prepares an item (KOT routing) — PRD 2.2.
create table if not exists public.item_station_routes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  item_id    uuid not null references public.menu_items(id) on delete cascade,
  station_id uuid not null references public.kitchen_stations(id) on delete cascade,
  unique (item_id, station_id)
);
create index if not exists idx_item_station_routes_tenant on public.item_station_routes(tenant_id);

-- --- Apply tenant RLS to every table above ----------------------------------
select public.apply_tenant_rls('public.floors');
select public.apply_tenant_rls('public.restaurant_tables');
select public.apply_tenant_rls('public.reservations');
select public.apply_tenant_rls('public.kitchen_stations');
select public.apply_tenant_rls('public.menu_categories');
select public.apply_tenant_rls('public.menus');
select public.apply_tenant_rls('public.menu_schedules');
select public.apply_tenant_rls('public.menu_items');
select public.apply_tenant_rls('public.menu_item_prices');
select public.apply_tenant_rls('public.item_variants');
select public.apply_tenant_rls('public.modifiers');
select public.apply_tenant_rls('public.item_modifiers');
select public.apply_tenant_rls('public.combos');
select public.apply_tenant_rls('public.item_station_routes');
