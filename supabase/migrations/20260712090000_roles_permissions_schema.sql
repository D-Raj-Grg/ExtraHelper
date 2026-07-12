-- ============================================================================
-- Custom roles + granular permissions. SAFETY: the existing app_role RLS is the
-- security floor; custom roles carry a base_role that bounds DB access, and the
-- permission set only refines (restricts) within it at the app layer.
-- ============================================================================

-- Global permission catalog (not tenant-scoped).
create table if not exists public.permissions (
  key   text primary key,
  grp   text not null,
  label text not null,
  sort  integer not null default 0
);
alter table public.permissions enable row level security;
create policy permissions_read on public.permissions for select to authenticated using (true);
grant select on public.permissions to authenticated;

insert into public.permissions (key, grp, label, sort) values
  ('dashboard.view','General','View dashboard',10),
  ('tables.view','General','View floors & tables',20),
  ('tables.edit','General','Edit floors & tables',30),
  ('settings.view','General','View settings',40),
  ('settings.edit','General','Edit settings',50),
  ('staff.view','General','View team',60),
  ('staff.edit','General','Manage team & roles',70),
  ('audit.view','General','View audit log',80),
  ('notifications.view','General','View notifications',90),
  ('order.view','Order','View orders (POS)',100),
  ('order.create','Order','Create orders',110),
  ('order.fire','Order','Fire to kitchen',120),
  ('order.void','Order','Void items',130),
  ('order.discount','Order','Give discount',140),
  ('checkout.view','Order','View bill / checkout',150),
  ('payment.take','Order','Take payment',160),
  ('payment.refund','Order','Refund payment',170),
  ('kds.view','Order','View kitchen (KDS)',180),
  ('kds.bump','Order','Bump KDS tickets',190),
  ('cash.view','Order','View cash drawer',200),
  ('cash.manage','Order','Manage cash sessions',210),
  ('menu.view','Menu','View menu',220),
  ('menu.edit','Menu','Edit menu',230),
  ('inventory.view','Inventory','View inventory',240),
  ('inventory.edit','Inventory','Adjust inventory',250),
  ('purchasing.view','Inventory','View purchasing',260),
  ('purchasing.edit','Inventory','Manage purchasing',270),
  ('loyalty.view','Customers','View loyalty & CRM',280),
  ('loyalty.edit','Customers','Manage loyalty',290),
  ('online.view','Customers','View online orders',300),
  ('online.manage','Customers','Manage online orders',310),
  ('reservations.view','Customers','View reservations',320),
  ('reservations.edit','Customers','Manage reservations',330),
  ('reports.view','Reports','View reports',340),
  ('billing.view','Billing','View billing & subscription',350)
on conflict (key) do nothing;

-- Per-tenant roles.
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  color       text not null default '#64748b',
  base_role   public.app_role not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table public.roles enable row level security;
create policy roles_read on public.roles for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy roles_write on public.roles for all to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager'))
  with check (public.has_tenant_role(tenant_id, 'owner', 'manager'));
grant select, insert, update, delete on public.roles to authenticated;

create table if not exists public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);
alter table public.role_permissions enable row level security;
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id
                 and (r.tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.has_tenant_role(r.tenant_id,'owner','manager')))
  with check (exists (select 1 from public.roles r where r.id = role_id and public.has_tenant_role(r.tenant_id,'owner','manager')));
grant select, insert, update, delete on public.role_permissions to authenticated;

-- Pending invites for emails without an account yet.
create table if not exists public.staff_invites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  email      text not null,
  role_id    uuid references public.roles(id) on delete set null,
  base_role  public.app_role not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
alter table public.staff_invites enable row level security;
create policy staff_invites_manage on public.staff_invites for all to authenticated
  using (public.has_tenant_role(tenant_id,'owner','manager') or public.is_platform_admin())
  with check (public.has_tenant_role(tenant_id,'owner','manager') or public.is_platform_admin());
grant select, insert, update, delete on public.staff_invites to authenticated;

-- Membership gains a custom role pointer + approval status (base role stays).
alter table public.user_tenants
  add column if not exists role_id uuid references public.roles(id) on delete set null;
alter table public.user_tenants
  add column if not exists status text not null default 'active' check (status in ('active','pending'));
