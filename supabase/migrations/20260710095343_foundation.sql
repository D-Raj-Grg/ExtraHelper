-- ============================================================================
-- Milestone 0 — Foundation: tenancy, memberships (RBAC), audit, settings.
-- Multi-tenancy: every business table carries tenant_id; RLS is the source of
-- truth. A user may hold different roles at different tenants, so the caller's
-- tenant_id + role are resolved from the user_tenants membership table (not from
-- a JWT claim). Helper fns are SECURITY DEFINER so RLS policies can call them
-- without recursing on user_tenants itself.
-- ============================================================================

-- --- Extensions -------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- --- Enums ------------------------------------------------------------------
-- Per-tenant staff roles. Platform Super Admin is NOT here (see platform_admins).
-- Customer is a public persona, not a staff membership.
do $$ begin
  create type public.app_role as enum (
    'owner', 'manager', 'receptionist', 'cashier', 'waiter', 'kitchen', 'inventory'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tenant_status as enum ('trial', 'active', 'suspended', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled');
exception when duplicate_object then null; end $$;

-- --- Shared trigger: maintain updated_at ------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================================
-- Platform layer (managed by us, the Super Admin) — NOT tenant-scoped.
-- ============================================================================

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,            -- 'starter' | 'pro' | 'enterprise'
  name        text not null,
  price_cents integer not null default 0,
  interval    text not null default 'month',   -- 'month' | 'year'
  features    jsonb not null default '{}',      -- feature flags per plan
  limits      jsonb not null default '{}',      -- e.g. {"branches": 1, "staff": 5}
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- Tenancy
-- ============================================================================

create table if not exists public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,             -- storefront subdomain/slug
  status     public.tenant_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tenants_updated before update on public.tenants
  for each row execute function public.set_updated_at();

create table if not exists public.branches (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  address    text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_branches_tenant on public.branches(tenant_id);
create trigger trg_branches_updated before update on public.branches
  for each row execute function public.set_updated_at();

-- Per-tenant configuration: region-configurable, never hardcoded (rule #2).
create table if not exists public.tenant_settings (
  tenant_id       uuid primary key references public.tenants(id) on delete cascade,
  currency        text not null default 'USD',
  timezone        text not null default 'UTC',
  tax_rules       jsonb not null default '[]',   -- [{name,rate,inclusive,...}]
  service_charge  numeric(5,2) not null default 0,
  packaging_fee   numeric(10,2) not null default 0,
  order_type_fees jsonb not null default '{}',   -- {dine_in:0, delivery:.., pickup:..}
  receipt_template jsonb not null default '{}',  -- {logo_url,footer,terms,...}
  updated_at      timestamptz not null default now()
);
create trigger trg_tenant_settings_updated before update on public.tenant_settings
  for each row execute function public.set_updated_at();

-- Subscription / SaaS monetization
create table if not exists public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  plan_id            uuid references public.plans(id),
  status             public.subscription_status not null default 'trialing',
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_subscriptions_tenant on public.subscriptions(tenant_id);
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table if not exists public.platform_invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_cents    integer not null default 0,
  currency        text not null default 'USD',
  status          text not null default 'open',  -- open|paid|void|uncollectible
  issued_at       timestamptz not null default now(),
  paid_at         timestamptz
);
create index if not exists idx_platform_invoices_tenant on public.platform_invoices(tenant_id);

-- ============================================================================
-- Users / RBAC / audit
-- ============================================================================

-- Membership = which tenant a user belongs to and with what role. Source of
-- truth for tenant isolation + RBAC. branch_id null = tenant-wide.
create table if not exists public.user_tenants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  role       public.app_role not null,
  branch_id  uuid references public.branches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);
create index if not exists idx_user_tenants_user on public.user_tenants(user_id);
create index if not exists idx_user_tenants_tenant on public.user_tenants(tenant_id);

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,          -- 'void'|'discount'|'refund'|'price_change'|'impersonate'|...
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_logs_tenant on public.audit_logs(tenant_id, created_at desc);

create table if not exists public.staff_shifts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid references public.branches(id) on delete set null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  clock_in   timestamptz not null default now(),
  clock_out  timestamptz,
  tips_cents integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_shifts_tenant on public.staff_shifts(tenant_id);

-- ============================================================================
-- RLS helper functions (SECURITY DEFINER — bypass RLS to avoid recursion).
-- ============================================================================

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Tenants the current user belongs to.
create or replace function public.current_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.user_tenants where user_id = auth.uid();
$$;

-- Does the current user hold any of the given roles at the given tenant?
create or replace function public.has_tenant_role(_tenant uuid, variadic _roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = _tenant and role = any(_roles)
  );
$$;

grant execute on function public.is_platform_admin(),
                          public.current_tenant_ids(),
                          public.has_tenant_role(uuid, public.app_role[])
  to anon, authenticated;

-- ============================================================================
-- Enable RLS + policies
-- ============================================================================

-- Platform tables --------------------------------------------------------------
alter table public.platform_admins enable row level security;
create policy platform_admins_self_read on public.platform_admins
  for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());

alter table public.plans enable row level security;
-- Plans are catalog data: any authenticated user may read (pricing/upgrade UI).
create policy plans_read on public.plans
  for select to authenticated using (true);
create policy plans_admin_write on public.plans
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Tenancy tables ---------------------------------------------------------------
alter table public.tenants enable row level security;
create policy tenants_member_read on public.tenants
  for select to authenticated
  using (id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy tenants_owner_update on public.tenants
  for update to authenticated
  using (public.has_tenant_role(id, 'owner') or public.is_platform_admin())
  with check (public.has_tenant_role(id, 'owner') or public.is_platform_admin());
-- INSERT of new tenants happens in a trusted server action / edge fn (onboarding),
-- which sets up the owner membership atomically. Platform admins may also insert.
create policy tenants_admin_insert on public.tenants
  for insert to authenticated with check (public.is_platform_admin());

alter table public.branches enable row level security;
create policy branches_member_read on public.branches
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy branches_manage on public.branches
  for all to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager'))
  with check (public.has_tenant_role(tenant_id, 'owner', 'manager'));

alter table public.tenant_settings enable row level security;
create policy tenant_settings_member_read on public.tenant_settings
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy tenant_settings_owner_write on public.tenant_settings
  for all to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager'))
  with check (public.has_tenant_role(tenant_id, 'owner', 'manager'));

alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions
  for select to authenticated
  using (public.has_tenant_role(tenant_id, 'owner') or public.is_platform_admin());
create policy subscriptions_admin_write on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.platform_invoices enable row level security;
create policy platform_invoices_read on public.platform_invoices
  for select to authenticated
  using (public.has_tenant_role(tenant_id, 'owner') or public.is_platform_admin());
create policy platform_invoices_admin_write on public.platform_invoices
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Membership / RBAC ------------------------------------------------------------
alter table public.user_tenants enable row level security;
-- A user always sees their own memberships; owners/managers see their tenant's roster.
create policy user_tenants_self_read on public.user_tenants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_tenant_role(tenant_id, 'owner', 'manager')
    or public.is_platform_admin()
  );
-- Only owners/managers (or platform admins) manage staff assignments.
create policy user_tenants_manage on public.user_tenants
  for all to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager') or public.is_platform_admin())
  with check (public.has_tenant_role(tenant_id, 'owner', 'manager') or public.is_platform_admin());

-- Audit logs: append-only. Members with oversight read; any tenant member writes
-- (the app writes them for sensitive actions the actor performs).
alter table public.audit_logs enable row level security;
create policy audit_logs_read on public.audit_logs
  for select to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager') or public.is_platform_admin());
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (tenant_id in (select public.current_tenant_ids()) and actor_id = auth.uid());

alter table public.staff_shifts enable row level security;
create policy staff_shifts_read on public.staff_shifts
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_tenant_role(tenant_id, 'owner', 'manager')
  );
create policy staff_shifts_self_write on public.staff_shifts
  for all to authenticated
  using (user_id = auth.uid() or public.has_tenant_role(tenant_id, 'owner', 'manager'))
  with check (
    (user_id = auth.uid() and tenant_id in (select public.current_tenant_ids()))
    or public.has_tenant_role(tenant_id, 'owner', 'manager')
  );
