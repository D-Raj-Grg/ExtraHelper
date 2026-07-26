-- Printing module — printer registry, station routing, job log.
--
-- Transport is a local agent (QZ Tray) that the browser talks to over a
-- localhost WebSocket; it pushes raw ESC/POS to the printer. The registry lives
-- here so routing (which station prints where, which printer is the cashier's)
-- is tenant data, not a per-device browser setting. Rule #6: the concrete
-- transport stays behind lib/integrations/printing.ts.

create type public.printer_connection as enum ('network', 'system');
create type public.printer_role       as enum ('kot', 'receipt', 'both');
create type public.print_job_status   as enum ('queued', 'printed', 'failed');

create table if not exists public.printers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid references public.branches(id) on delete cascade,
  name        text not null,
  connection  public.printer_connection not null default 'network',
  -- Network printers need a STATIC ip; DHCP breaks them on router restart.
  host        text,
  port        integer not null default 9100,
  -- System/USB printers are addressed by the name the OS gives them.
  system_name text,
  paper_width integer not null default 80 check (paper_width in (58, 80)),
  role        public.printer_role not null default 'both',
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint printers_target_present check (
    (connection = 'network' and host is not null and length(btrim(host)) > 0)
    or (connection = 'system' and system_name is not null and length(btrim(system_name)) > 0)
  )
);
create index if not exists idx_printers_tenant on public.printers(tenant_id);
create trigger trg_printers_updated before update on public.printers
  for each row execute function public.set_updated_at();

-- One default per role per branch. branch_id is nullable, so coalesce it into a
-- sentinel — nulls compare distinct and would let several defaults through.
create unique index if not exists uq_printer_default
  on public.printers(tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), role)
  where is_default;

-- Which printer a station's tickets go to. Null = fall back to the tenant
-- default KOT printer, then to browser printing.
alter table public.kitchen_stations
  add column if not exists printer_id uuid references public.printers(id) on delete set null;

create table if not exists public.print_jobs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  printer_id uuid references public.printers(id) on delete set null,
  type       text not null check (type in ('kot', 'receipt', 'test')),
  kot_id     uuid references public.kots(id) on delete set null,
  bill_id    uuid references public.bills(id) on delete set null,
  status     public.print_job_status not null default 'queued',
  attempts   integer not null default 0,
  error      text,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);
create index if not exists idx_print_jobs_tenant
  on public.print_jobs(tenant_id, created_at desc);

select public.apply_tenant_rls('public.printers');
select public.apply_tenant_rls('public.print_jobs');
