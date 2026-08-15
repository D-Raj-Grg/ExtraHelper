-- ============================================================================
-- Cash movements + supplier payments.
--
-- close_cash_session only ever ADDED cash sales to the float, so every rupee
-- that left the drawer — a supplier paid in cash, a bundle of lemons — read as
-- a shortfall with no explanation. cash_movements is the missing side of that
-- ledger and means strictly ONE thing: physical cash in or out of the POS
-- drawer. Money paid to a supplier by any other method is a supplier_payments
-- row and nothing else; a table named for cash must never hold non-cash rows,
-- or every later query needs a filter it can silently omit.
--
-- Writes go through SECURITY DEFINER RPCs (later migration). RLS grants select
-- only — the same split the menu write guards use.
-- ============================================================================

do $$ begin
  create type public.cash_movement_kind as enum ('payout', 'paid_in');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_movement_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_movement_category as enum
    ('supplier', 'supplies', 'utilities', 'staff_advance', 'transport', 'other');
exception when duplicate_object then null; end $$;

-- Money paid to a supplier, by any method. Tracks credit (udhaaro): goods can
-- arrive today and be paid for next week, so receipt and payment are separate
-- events and a PO reference is optional (an on-account payment settles old
-- credit without belonging to one delivery).
create table if not exists public.supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  supplier_id  uuid not null references public.suppliers(id) on delete restrict,
  po_id        uuid references public.purchase_orders(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method       public.payment_method not null,
  paid_at      timestamptz not null default now(),
  note         text,
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

-- Physical cash in or out of the POS drawer. session_id is NOT NULL on purpose:
-- cash cannot leave a drawer that is not open, and a movement with no session
-- could never be reconciled against a count. A supplier paid at 6am before any
-- shift opens is a supplier_payments row with a non-cash method instead.
create table if not exists public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  session_id    uuid not null references public.cash_sessions(id) on delete cascade,
  kind          public.cash_movement_kind not null,
  category      public.cash_movement_category not null,
  amount_cents  integer not null check (amount_cents > 0),
  -- A payout with no stated reason cannot be audited later, which defeats the
  -- point of recording it at all.
  note          text not null check (length(btrim(note)) > 0),
  supplier_payment_id uuid references public.supplier_payments(id) on delete set null,
  status        public.cash_movement_status not null default 'pending',
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  auto_approved boolean not null default false
);

create index if not exists idx_cash_movements_session on public.cash_movements(session_id);
create index if not exists idx_cash_movements_tenant  on public.cash_movements(tenant_id, created_at desc);
create index if not exists idx_supplier_payments_supplier on public.supplier_payments(tenant_id, supplier_id);
create index if not exists idx_supplier_payments_po on public.supplier_payments(po_id);

alter table public.cash_movements    enable row level security;
alter table public.supplier_payments enable row level security;

-- Read is open to tenant members; the drawer panel and the payables block both
-- need it. Every write path is an RPC, so there is deliberately no insert,
-- update, or delete policy on either table.
drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements
  for select to authenticated
  using (exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = cash_movements.tenant_id
      and ut.status = 'active'
  ));

drop policy if exists supplier_payments_read on public.supplier_payments;
create policy supplier_payments_read on public.supplier_payments
  for select to authenticated
  using (exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = supplier_payments.tenant_id
      and ut.status = 'active'
  ));

grant select on public.cash_movements    to authenticated;
grant select on public.supplier_payments to authenticated;
