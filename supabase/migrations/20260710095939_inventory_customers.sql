-- ============================================================================
-- Milestone 0 core schema (4/4) — Inventory/BOM, Customers/Loyalty, Online.
-- Selling a dish auto-deducts ingredient stock via recipes (theoretical usage) —
-- the deduction trigger lands with Milestone 3; the model is defined here.
-- ============================================================================

do $$ begin
  create type public.stock_movement_type as enum
    ('purchase','sale','wastage','staff_meal','transfer','adjustment','count');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.po_status as enum ('draft','sent','partial','received','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loyalty_txn_type as enum ('earn','burn','adjust');
exception when duplicate_object then null; end $$;

-- --- Inventory --------------------------------------------------------------
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete cascade,
  name          text not null,
  uom           text not null default 'unit',   -- kg, g, l, ml, unit
  category      text,
  reorder_level numeric(12,3) not null default 0,
  par_level     numeric(12,3) not null default 0,
  cost_cents    integer not null default 0,      -- avg/last cost per uom
  current_qty   numeric(12,3) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_inventory_items_tenant on public.inventory_items(tenant_id);
create trigger trg_inventory_items_updated before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- Recipe / BOM: menu item -> ingredient qty consumed per sale.
create table if not exists public.recipes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  menu_item_id      uuid not null references public.menu_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  qty               numeric(12,3) not null default 0,
  unique (menu_item_id, inventory_item_id)
);
create index if not exists idx_recipes_tenant on public.recipes(tenant_id);

create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  contact    text,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_suppliers_tenant on public.suppliers(tenant_id);

create table if not exists public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status      public.po_status not null default 'draft',
  total_cents integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_purchase_orders_tenant on public.purchase_orders(tenant_id);
create trigger trg_purchase_orders_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create table if not exists public.po_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  po_id             uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  qty_ordered       numeric(12,3) not null default 0,
  qty_received      numeric(12,3) not null default 0,
  unit_cost_cents   integer not null default 0
);
create index if not exists idx_po_items_tenant on public.po_items(tenant_id);

create table if not exists public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  branch_id         uuid references public.branches(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  type              public.stock_movement_type not null,
  qty               numeric(12,3) not null default 0,  -- signed: + in, - out
  reference         text,                               -- order id, po id, etc.
  created_at        timestamptz not null default now()
);
create index if not exists idx_stock_movements_tenant on public.stock_movements(tenant_id, created_at desc);

create table if not exists public.stock_counts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete cascade,
  counted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_counts_tenant on public.stock_counts(tenant_id);

create table if not exists public.stock_count_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  stock_count_id    uuid not null references public.stock_counts(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  theoretical_qty   numeric(12,3) not null default 0,
  actual_qty        numeric(12,3) not null default 0,
  variance          numeric(12,3) generated always as (actual_qty - theoretical_qty) stored
);
create index if not exists idx_stock_count_items_tenant on public.stock_count_items(tenant_id);

create table if not exists public.wastage (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  branch_id         uuid references public.branches(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  qty               numeric(12,3) not null default 0,
  reason            text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_wastage_tenant on public.wastage(tenant_id);

-- --- Customers / loyalty / CRM ----------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,  -- if they have a login
  name       text,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_customers_tenant on public.customers(tenant_id);

create table if not exists public.loyalty_accounts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  customer_id    uuid not null references public.customers(id) on delete cascade,
  points_balance integer not null default 0,
  tier           text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, customer_id)
);
create index if not exists idx_loyalty_accounts_tenant on public.loyalty_accounts(tenant_id);

create table if not exists public.loyalty_transactions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  loyalty_account_id uuid not null references public.loyalty_accounts(id) on delete cascade,
  type               public.loyalty_txn_type not null,
  points             integer not null default 0,
  reference          text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_loyalty_transactions_tenant on public.loyalty_transactions(tenant_id);

create table if not exists public.coupons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  type        public.discount_type not null,
  value       numeric(10,2) not null,
  valid_from  timestamptz,
  valid_to    timestamptz,
  usage_limit integer,
  used_count  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists idx_coupons_tenant on public.coupons(tenant_id);

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_id    uuid references public.orders(id) on delete set null,
  rating      smallint,
  comment     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_feedback_tenant on public.feedback(tenant_id);

-- --- Online orders / delivery -----------------------------------------------
create table if not exists public.online_orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  channel     text not null default 'web',     -- web / qr
  fulfillment public.order_type not null default 'delivery',
  address     jsonb,
  slot_at     timestamptz,
  fee_cents   integer not null default 0,
  status      text not null default 'received',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_online_orders_tenant on public.online_orders(tenant_id, created_at desc);
create trigger trg_online_orders_updated before update on public.online_orders
  for each row execute function public.set_updated_at();

create table if not exists public.delivery_tracking (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  online_order_id uuid not null references public.online_orders(id) on delete cascade,
  status          text not null default 'pending',
  driver_name     text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_delivery_tracking_tenant on public.delivery_tracking(tenant_id);

-- --- Wire deferred customer FKs from earlier migrations ----------------------
alter table public.orders
  add constraint fk_orders_customer
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.reservations
  add constraint fk_reservations_customer
  foreign key (customer_id) references public.customers(id) on delete set null;

-- --- Apply tenant RLS -------------------------------------------------------
select public.apply_tenant_rls('public.inventory_items');
select public.apply_tenant_rls('public.recipes');
select public.apply_tenant_rls('public.suppliers');
select public.apply_tenant_rls('public.purchase_orders');
select public.apply_tenant_rls('public.po_items');
select public.apply_tenant_rls('public.stock_movements');
select public.apply_tenant_rls('public.stock_counts');
select public.apply_tenant_rls('public.stock_count_items');
select public.apply_tenant_rls('public.wastage');
select public.apply_tenant_rls('public.customers');
select public.apply_tenant_rls('public.loyalty_accounts');
select public.apply_tenant_rls('public.loyalty_transactions');
select public.apply_tenant_rls('public.coupons');
select public.apply_tenant_rls('public.feedback');
select public.apply_tenant_rls('public.online_orders');
select public.apply_tenant_rls('public.delivery_tracking');
