-- ============================================================================
-- Milestone 0 core schema (3/4) — Orders/KOT + Billing/POS.
-- Order lifecycle: draft→placed→in_kitchen→preparing→ready→served→billed→closed.
-- Idempotency keys on orders/payments (offline resilience, rule #4).
-- ============================================================================

do $$ begin
  create type public.order_status as enum
    ('draft','placed','in_kitchen','preparing','ready','served','billed','closed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.kot_status as enum ('new','preparing','ready','served','recalled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('cash','card','online','wallet','points');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending','completed','failed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bill_status as enum ('open','partial','paid','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.discount_type as enum ('percent','flat');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_session_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

-- --- Billing (created first so orders can reference bill_id) -----------------
create table if not exists public.bills (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  branch_id           uuid references public.branches(id) on delete cascade,
  table_id            uuid references public.restaurant_tables(id) on delete set null,
  status              public.bill_status not null default 'open',
  subtotal_cents      integer not null default 0,
  tax_cents           integer not null default 0,
  service_charge_cents integer not null default 0,
  discount_cents      integer not null default 0,
  total_cents         integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_bills_tenant on public.bills(tenant_id, created_at desc);
create trigger trg_bills_updated before update on public.bills
  for each row execute function public.set_updated_at();

-- --- Orders / KOT -----------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  table_id        uuid references public.restaurant_tables(id) on delete set null,
  bill_id         uuid references public.bills(id) on delete set null,
  order_type      public.order_type not null default 'dine_in',
  status          public.order_status not null default 'draft',
  waiter_id       uuid references auth.users(id) on delete set null,
  customer_id     uuid,                       -- FK added in customers migration
  notes           text,
  idempotency_key text,                       -- offline sync dedup
  placed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists idx_orders_tenant on public.orders(tenant_id, created_at desc);
create index if not exists idx_orders_table on public.orders(table_id);
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

-- Now that orders exists, wire the table's live order pointer.
alter table public.restaurant_tables
  add constraint fk_tables_current_order
  foreign key (current_order_id) references public.orders(id) on delete set null;

create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  item_id          uuid references public.menu_items(id) on delete set null,
  variant_id       uuid references public.item_variants(id) on delete set null,
  name_snapshot    text not null,             -- name at time of order
  qty              integer not null default 1,
  unit_price_cents integer not null default 0,
  seat             integer,
  course           integer,
  notes            text,
  status           public.order_status not null default 'placed',
  is_void          boolean not null default false,
  void_reason      text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_order_items_tenant on public.order_items(tenant_id);
create index if not exists idx_order_items_order on public.order_items(order_id);

create table if not exists public.order_item_modifiers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  modifier_id   uuid references public.modifiers(id) on delete set null,
  name_snapshot text not null,
  qty           integer not null default 1,
  price_cents   integer not null default 0
);
create index if not exists idx_order_item_modifiers_tenant on public.order_item_modifiers(tenant_id);

create table if not exists public.kots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  order_id   uuid not null references public.orders(id) on delete cascade,
  station_id uuid references public.kitchen_stations(id) on delete set null,
  status     public.kot_status not null default 'new',
  printed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_kots_tenant on public.kots(tenant_id, created_at desc);

create table if not exists public.kot_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  kot_id        uuid not null references public.kots(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  qty           integer not null default 1,
  status        public.kot_status not null default 'new'
);
create index if not exists idx_kot_items_tenant on public.kot_items(tenant_id);

-- --- Billing detail ---------------------------------------------------------
create table if not exists public.taxes (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name      text not null,                     -- VAT / GST / Service tax
  rate      numeric(6,3) not null default 0,   -- percent
  inclusive boolean not null default false
);
create index if not exists idx_taxes_tenant on public.taxes(tenant_id);

create table if not exists public.bill_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  bill_id          uuid not null references public.bills(id) on delete cascade,
  order_item_id    uuid references public.order_items(id) on delete set null,
  description      text not null,
  qty              integer not null default 1,
  unit_price_cents integer not null default 0,
  tax_cents        integer not null default 0,
  total_cents      integer not null default 0
);
create index if not exists idx_bill_items_tenant on public.bill_items(tenant_id);
create index if not exists idx_bill_items_bill on public.bill_items(bill_id);

create table if not exists public.discounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  bill_id       uuid references public.bills(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  type          public.discount_type not null,
  value         numeric(10,2) not null,
  coupon_code   text,
  reason        text,
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_discounts_tenant on public.discounts(tenant_id);

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  bill_id         uuid not null references public.bills(id) on delete cascade,
  method          public.payment_method not null,
  amount_cents    integer not null default 0,
  status          public.payment_status not null default 'pending',
  reference       text,                        -- gateway txn id
  idempotency_key text,
  created_at      timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists idx_payments_tenant on public.payments(tenant_id, created_at desc);

create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  bill_id      uuid references public.bills(id) on delete set null,
  payment_id   uuid references public.payments(id) on delete set null,
  amount_cents integer not null default 0,
  reason       text,
  approved_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_refunds_tenant on public.refunds(tenant_id);

create table if not exists public.cash_sessions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  branch_id          uuid references public.branches(id) on delete cascade,
  cashier_id         uuid references auth.users(id) on delete set null,
  status             public.cash_session_status not null default 'open',
  opening_float_cents integer not null default 0,
  expected_cents     integer not null default 0,
  counted_cents      integer,
  variance_cents     integer,
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz
);
create index if not exists idx_cash_sessions_tenant on public.cash_sessions(tenant_id);

-- --- Apply tenant RLS -------------------------------------------------------
select public.apply_tenant_rls('public.bills');
select public.apply_tenant_rls('public.orders');
select public.apply_tenant_rls('public.order_items');
select public.apply_tenant_rls('public.order_item_modifiers');
select public.apply_tenant_rls('public.kots');
select public.apply_tenant_rls('public.kot_items');
select public.apply_tenant_rls('public.taxes');
select public.apply_tenant_rls('public.bill_items');
select public.apply_tenant_rls('public.discounts');
select public.apply_tenant_rls('public.payments');
select public.apply_tenant_rls('public.refunds');
select public.apply_tenant_rls('public.cash_sessions');
