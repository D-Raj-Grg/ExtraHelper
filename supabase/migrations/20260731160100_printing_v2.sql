-- Printing v2, part 2 of 2: the registry, the queue, and the rules in Postgres.
--
-- The module shipped on 2026-07-22 got the transport right and the model wrong.
-- Four things were structurally broken, all of them invisible until a real
-- service:
--
--   1. Printing only happened in an open browser tab. QZ Tray is driven from
--      the page, so a QR or online order arriving at 02:00 with nobody at the
--      POS printed nothing at all. There was no queue — `print_jobs` was a log
--      written *after* the fact, not work waiting to be done.
--   2. Two POS tabs meant two tickets. Nothing claimed a job.
--   3. `printers` and `print_jobs` used `apply_tenant_rls`, which is `for all`.
--      The owner/manager check lived in a TypeScript server action, so any
--      member of the restaurant — a waiter, an inventory clerk — could add,
--      re-point or delete a printer straight through PostgREST. Same hole as
--      20260727120000_manager_ops.sql and 20260731140000_kot_ops.sql closed
--      elsewhere, missed here for the same reason.
--   4. `printers.branch_id` existed but was never written and never filtered,
--      so a two-branch tenant would print Branch B's tickets in Branch A.
--
-- The model change: `printers.role` (kot | receipt | both) becomes a set of
-- rows in `printer_documents`. Assigning a document to a printer *is* the
-- auto-print switch — a printer with no documents assigned still exists and can
-- still be picked for a manual print, it just never fires on its own. Several
-- printers may carry the same document; all of them print it. That makes
-- `is_default` and its one-default-per-role unique index meaningless, so both
-- go.
--
-- Jobs are now enqueued by triggers in Postgres rather than by whichever client
-- happened to be on screen, which is what makes auto-print work on every path
-- at once — POS, QR, online storefront, and the Flutter apps — without any of
-- them knowing about printing. Rows carry a reference (`kot_id` / `bill_id` /
-- `order_id`) and no payload: whoever claims the job asks the server to render
-- it, so there is one rendering source of truth and never a stale byte string
-- describing an order that has since been amended.

-- ---------------------------------------------------------------------------
-- printers: USB addressing, render mode, per-device paper behaviour
-- ---------------------------------------------------------------------------

alter table public.printers
  add column if not exists usb_vendor_id  text,
  add column if not exists usb_product_id text,
  -- Interface and endpoint are discovered from the device on first successful
  -- print and cached here; the setup screen only asks for vendor + product,
  -- the two numbers printed on the box.
  add column if not exists usb_interface  text,
  add column if not exists usb_endpoint   text,
  add column if not exists render_mode    public.printer_render_mode not null default 'text',
  -- Not every thermal head has a cutter, and only the cashier's printer has a
  -- drawer hanging off it. Firing either blindly is how a kitchen printer ends
  -- up spitting control codes onto the ticket.
  add column if not exists auto_cut       boolean not null default true,
  add column if not exists open_drawer    boolean not null default false;

-- 76mm is the common impact-printer width; the two checks below are replaced
-- rather than added to, since a CHECK cannot be altered in place.
do $$
declare _c text;
begin
  for _c in
    select conname from pg_constraint
     where conrelid = 'public.printers'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%paper_width%'
  loop
    execute format('alter table public.printers drop constraint %I', _c);
  end loop;
end $$;

alter table public.printers
  add constraint printers_paper_width_check check (paper_width in (58, 76, 80));

alter table public.printers drop constraint if exists printers_target_present;
alter table public.printers add constraint printers_target_present check (
  (connection = 'network' and host is not null and length(btrim(host)) > 0)
  or (connection = 'usb'
      and usb_vendor_id is not null and length(btrim(usb_vendor_id)) > 0
      and usb_product_id is not null and length(btrim(usb_product_id)) > 0)
  or (connection = 'system' and system_name is not null and length(btrim(system_name)) > 0)
);

-- ---------------------------------------------------------------------------
-- printer_documents: what each printer prints on its own
-- ---------------------------------------------------------------------------

create table if not exists public.printer_documents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  printer_id uuid not null references public.printers(id) on delete cascade,
  doc        public.print_doc not null,
  copies     integer not null default 1 check (copies between 1 and 5),
  created_at timestamptz not null default now(),
  unique (printer_id, doc),
  -- 'test' is a manual act by definition; assigning it would mean a printer
  -- that prints test pages by itself.
  constraint printer_documents_not_test check (doc <> 'test')
);
create index if not exists idx_printer_documents_tenant on public.printer_documents(tenant_id);

-- Carry the old role across before it is dropped. 'kot' covered bar tickets
-- too, since BOT did not exist yet.
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'printers' and column_name = 'role'
  ) then
    insert into public.printer_documents (tenant_id, printer_id, doc)
    select p.tenant_id, p.id, d.doc
      from public.printers p
      cross join lateral unnest(
        case p.role
          when 'kot'     then array['kot','bot']::public.print_doc[]
          when 'receipt' then array['bill']::public.print_doc[]
          else                array['kot','bot','bill']::public.print_doc[]
        end
      ) as d(doc)
    on conflict do nothing;
  end if;
end $$;

drop index if exists public.uq_printer_default;
alter table public.printers drop column if exists role;
alter table public.printers drop column if exists is_default;
drop type if exists public.printer_role;

-- ---------------------------------------------------------------------------
-- kitchen_stations: kitchen or bar
-- ---------------------------------------------------------------------------

alter table public.kitchen_stations
  add column if not exists kind public.station_kind not null default 'kitchen';

-- ---------------------------------------------------------------------------
-- print_jobs: a queue, not a log
-- ---------------------------------------------------------------------------

alter table public.print_jobs
  add column if not exists doc             public.print_doc,
  add column if not exists order_id        uuid references public.orders(id) on delete set null,
  add column if not exists branch_id       uuid references public.branches(id) on delete set null,
  add column if not exists copies          integer not null default 1 check (copies between 1 and 5),
  add column if not exists claimed_at      timestamptz,
  add column if not exists claimed_by      text,
  -- Deliberately unique per (document, subject, printer): a re-fire, a retried
  -- server action or a second trigger pass all resolve to the same key and the
  -- insert is a no-op. Reprints are explicit and carry no key.
  add column if not exists idempotency_key text;

do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'print_jobs' and column_name = 'type'
  ) then
    update public.print_jobs
       set doc = (case type when 'receipt' then 'bill' else type end)::public.print_doc
     where doc is null;
    alter table public.print_jobs drop column type;
  end if;
end $$;

update public.print_jobs set doc = 'test' where doc is null;
alter table public.print_jobs alter column doc set not null;

create unique index if not exists uq_print_jobs_idem
  on public.print_jobs(tenant_id, idempotency_key)
  where idempotency_key is not null;

-- The claim query's index: pending work for one tenant, oldest first.
create index if not exists idx_print_jobs_pending
  on public.print_jobs(tenant_id, created_at)
  where status in ('queued', 'claimed');

-- ---------------------------------------------------------------------------
-- tenant_settings: local (browser + QZ) vs cloud (headless agent)
-- ---------------------------------------------------------------------------

alter table public.tenant_settings
  add column if not exists printing_mode text not null default 'local';
alter table public.tenant_settings drop constraint if exists tenant_settings_printing_mode_check;
alter table public.tenant_settings
  add constraint tenant_settings_printing_mode_check check (printing_mode in ('local', 'cloud'));

-- ---------------------------------------------------------------------------
-- Plan limits
-- ---------------------------------------------------------------------------

-- Null means unlimited: an absent key must not read as zero, or a tenant on a
-- plan that never mentioned printers could not add one.
--
-- The membership clause is not decoration. SECURITY DEFINER runs as the owner,
-- so without it any signed-in user could ask what plan any other restaurant is
-- on by passing its id.
create or replace function public.tenant_limit(_tenant uuid, _key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select nullif(pl.limits ->> _key, '')::integer
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
   where s.tenant_id = _tenant
     and (_tenant in (select public.current_tenant_ids()) or public.is_platform_admin())
   limit 1
$$;

revoke execute on function public.tenant_limit(uuid, text) from public, anon;
grant execute on function public.tenant_limit(uuid, text) to authenticated;

update public.plans set limits = limits || jsonb_build_object('printers', 2)  where code = 'starter';
update public.plans set limits = limits || jsonb_build_object('printers', 10) where code = 'pro';
update public.plans set limits = limits || jsonb_build_object('printers', 100) where code = 'enterprise';

-- ---------------------------------------------------------------------------
-- RLS: readable by the tenant, writable only through the functions below
-- ---------------------------------------------------------------------------

drop policy if exists tenant_all on public.printers;
drop policy if exists tenant_all on public.print_jobs;
drop policy if exists printers_read on public.printers;
drop policy if exists printer_documents_read on public.printer_documents;
drop policy if exists print_jobs_read on public.print_jobs;

alter table public.printer_documents enable row level security;

create policy printers_read on public.printers
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

create policy printer_documents_read on public.printer_documents
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

create policy print_jobs_read on public.print_jobs
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Registry writes
-- ---------------------------------------------------------------------------

-- _docs is [{"doc":"kot","copies":1}, ...] and is replace-all: what the setup
-- sheet shows is exactly what the printer ends up carrying.
create or replace function public.save_printer(
  _tenant         uuid,
  _id             uuid,
  _name           text,
  _connection     public.printer_connection,
  _host           text,
  _port           integer,
  _system_name    text,
  _usb_vendor_id  text,
  _usb_product_id text,
  _paper_width    integer,
  _render_mode    public.printer_render_mode,
  _auto_cut       boolean,
  _open_drawer    boolean,
  _branch_id      uuid,
  _is_active      boolean,
  _docs           jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _printer uuid; _limit integer; _used integer;
begin
  -- Argument order is (tenant, key). The generated types list them
  -- alphabetically, which hides the real order and fails only at run time.
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to change printers' using errcode = '42501';
  end if;
  if _name is null or length(btrim(_name)) = 0 then
    raise exception 'give the printer a name' using errcode = '22023';
  end if;
  if _branch_id is not null and not exists (
    select 1 from public.branches where id = _branch_id and tenant_id = _tenant
  ) then
    raise exception 'unknown branch' using errcode = '22023';
  end if;

  if _id is null then
    _limit := public.tenant_limit(_tenant, 'printers');
    if _limit is not null then
      select count(*) into _used from public.printers where tenant_id = _tenant;
      if _used >= _limit then
        raise exception 'your plan allows % printers', _limit using errcode = '22023';
      end if;
    end if;

    insert into public.printers (
      tenant_id, branch_id, name, connection, host, port, system_name,
      usb_vendor_id, usb_product_id, paper_width, render_mode,
      auto_cut, open_drawer, is_active
    ) values (
      _tenant, _branch_id, btrim(_name), _connection,
      nullif(btrim(coalesce(_host, '')), ''), coalesce(_port, 9100),
      nullif(btrim(coalesce(_system_name, '')), ''),
      nullif(btrim(coalesce(_usb_vendor_id, '')), ''),
      nullif(btrim(coalesce(_usb_product_id, '')), ''),
      _paper_width, _render_mode, _auto_cut, _open_drawer, _is_active
    )
    returning id into _printer;
  else
    update public.printers set
      branch_id      = _branch_id,
      name           = btrim(_name),
      connection     = _connection,
      host           = nullif(btrim(coalesce(_host, '')), ''),
      port           = coalesce(_port, 9100),
      system_name    = nullif(btrim(coalesce(_system_name, '')), ''),
      usb_vendor_id  = nullif(btrim(coalesce(_usb_vendor_id, '')), ''),
      usb_product_id = nullif(btrim(coalesce(_usb_product_id, '')), ''),
      -- Re-addressing the device invalidates the cached interface/endpoint.
      usb_interface  = case when connection is distinct from _connection
                             or usb_vendor_id is distinct from nullif(btrim(coalesce(_usb_vendor_id, '')), '')
                            then null else usb_interface end,
      usb_endpoint   = case when connection is distinct from _connection
                             or usb_vendor_id is distinct from nullif(btrim(coalesce(_usb_vendor_id, '')), '')
                            then null else usb_endpoint end,
      paper_width    = _paper_width,
      render_mode    = _render_mode,
      auto_cut       = _auto_cut,
      open_drawer    = _open_drawer,
      is_active      = _is_active
    where id = _id and tenant_id = _tenant
    returning id into _printer;

    if _printer is null then
      raise exception 'printer not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.printer_documents where printer_id = _printer;
  insert into public.printer_documents (tenant_id, printer_id, doc, copies)
  select _tenant, _printer,
         (d ->> 'doc')::public.print_doc,
         greatest(1, least(5, coalesce((d ->> 'copies')::integer, 1)))
    from jsonb_array_elements(coalesce(_docs, '[]'::jsonb)) d
   where (d ->> 'doc') <> 'test'
  on conflict do nothing;

  return _printer;
end $$;

create or replace function public.delete_printer(_printer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.printers where id = _printer_id;
  if _tenant is null then
    raise exception 'printer not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to remove a printer' using errcode = '42501';
  end if;

  -- Stations pointing here are unrouted by the FK; their tickets fall back to
  -- whichever printer carries the document, then to the browser.
  delete from public.printers where id = _printer_id and tenant_id = _tenant;
end $$;

create or replace function public.set_station_printer(_station_id uuid, _printer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.kitchen_stations where id = _station_id;
  if _tenant is null then
    raise exception 'station not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to route a station' using errcode = '42501';
  end if;
  if _printer_id is not null and not exists (
    select 1 from public.printers where id = _printer_id and tenant_id = _tenant
  ) then
    raise exception 'unknown printer' using errcode = '22023';
  end if;

  update public.kitchen_stations set printer_id = _printer_id
   where id = _station_id and tenant_id = _tenant;
end $$;

create or replace function public.set_station_kind(_station_id uuid, _kind public.station_kind)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.kitchen_stations where id = _station_id;
  if _tenant is null then
    raise exception 'station not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to change a station' using errcode = '42501';
  end if;

  update public.kitchen_stations set kind = _kind
   where id = _station_id and tenant_id = _tenant;
end $$;

create or replace function public.set_printing_mode(_tenant uuid, _mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(_tenant, 'settings.edit') then
    raise exception 'not authorized to change printing' using errcode = '42501';
  end if;
  if _mode not in ('local', 'cloud') then
    raise exception 'unknown printing mode' using errcode = '22023';
  end if;

  insert into public.tenant_settings (tenant_id, printing_mode)
  values (_tenant, _mode)
  on conflict (tenant_id) do update set printing_mode = excluded.printing_mode;
end $$;

-- Cache what the agent discovered so the next print skips the interface scan.
create or replace function public.set_printer_usb_path(
  _printer_id uuid, _interface text, _endpoint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.printers where id = _printer_id;
  if _tenant is null or _tenant not in (select public.current_tenant_ids()) then
    raise exception 'printer not found' using errcode = 'P0002';
  end if;

  update public.printers
     set usb_interface = _interface, usb_endpoint = _endpoint
   where id = _printer_id and tenant_id = _tenant;
end $$;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_print_job(
  _tenant    uuid,
  _doc       public.print_doc,
  _printer_id uuid,
  _kot_id    uuid,
  _bill_id   uuid,
  _order_id  uuid,
  _copies    integer,
  _idem      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _job uuid; _branch uuid; _needed text;
begin
  if _tenant not in (select public.current_tenant_ids()) then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  _needed := case
    when _doc in ('kot', 'bot', 'full_kot', 'order_slip') then 'order.view'
    when _doc = 'bill' then 'checkout.view'
    else 'settings.edit'
  end;
  if not public.has_permission(_tenant, _needed) then
    raise exception 'not authorized to print this' using errcode = '42501';
  end if;

  select coalesce(o.branch_id, b.branch_id) into _branch
    from (select 1) x
    left join public.orders o on o.id = _order_id
    left join public.bills  b on b.id = _bill_id;

  insert into public.print_jobs (
    tenant_id, printer_id, doc, kot_id, bill_id, order_id, branch_id, copies, idempotency_key
  ) values (
    _tenant, _printer_id, _doc, _kot_id, _bill_id, _order_id, _branch,
    greatest(1, least(5, coalesce(_copies, 1))), _idem
  )
  on conflict do nothing
  returning id into _job;

  if _job is null and _idem is not null then
    select id into _job from public.print_jobs
     where tenant_id = _tenant and idempotency_key = _idem;
  end if;

  return _job;
end $$;

-- One claimer wins each job. `for update skip locked` is the whole trick: a
-- second POS tab or a second agent asking at the same moment steps over the
-- locked rows instead of queueing behind them, so nobody waits and nobody
-- prints a duplicate.
create or replace function public.claim_print_jobs(
  _tenant uuid, _branch uuid, _claimer text, _limit integer
)
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if _tenant not in (select public.current_tenant_ids()) then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  -- A tab that claimed a job and was then closed must not strand it.
  update public.print_jobs
     set status = 'queued', claimed_at = null, claimed_by = null
   where tenant_id = _tenant
     and status = 'claimed'
     and claimed_at < now() - interval '60 seconds';

  return query
  update public.print_jobs j
     set status = 'claimed', claimed_at = now(), claimed_by = _claimer
   where j.id in (
     select c.id from public.print_jobs c
      where c.tenant_id = _tenant
        and c.status = 'queued'
        and (_branch is null or c.branch_id is null or c.branch_id = _branch)
      order by c.created_at
      for update skip locked
      limit greatest(1, least(25, coalesce(_limit, 5)))
   )
  returning j.*;
end $$;

create or replace function public.complete_print_job(
  _job_id uuid, _status public.print_job_status, _error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _kot uuid;
begin
  select tenant_id, kot_id into _tenant, _kot from public.print_jobs where id = _job_id;
  if _tenant is null or _tenant not in (select public.current_tenant_ids()) then
    raise exception 'unknown print job' using errcode = 'P0002';
  end if;

  update public.print_jobs
     set status     = _status,
         attempts   = attempts + 1,
         error      = left(_error, 500),
         printed_at = case when _status = 'printed' then now() else printed_at end,
         claimed_at = null,
         claimed_by = null
   where id = _job_id and tenant_id = _tenant;

  -- `printed` means paper came out, not that a page was opened. This is the
  -- only thing that stamps it.
  if _status = 'printed' and _kot is not null then
    update public.kots set printed_at = now()
     where id = _kot and tenant_id = _tenant;
  end if;
end $$;

-- Put a failed job back in the queue rather than re-rendering it from the UI.
create or replace function public.retry_print_job(_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.print_jobs where id = _job_id;
  if _tenant is null or _tenant not in (select public.current_tenant_ids()) then
    raise exception 'unknown print job' using errcode = 'P0002';
  end if;

  update public.print_jobs
     set status = 'queued', error = null, claimed_at = null, claimed_by = null
   where id = _job_id and tenant_id = _tenant;
end $$;

-- ---------------------------------------------------------------------------
-- Enqueue triggers — the reason auto-print works with nothing on screen
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_kot_print()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _printer uuid; _kind public.station_kind; _doc public.print_doc; _branch uuid; _copies integer;
begin
  select s.kind, s.printer_id into _kind, _printer
    from public.kitchen_stations s where s.id = new.station_id;
  _doc := case when _kind = 'bar' then 'bot' else 'kot' end;

  select o.branch_id into _branch from public.orders o where o.id = new.order_id;

  if _printer is not null then
    -- An explicit station route wins outright: splitting tickets per station
    -- is the entire point of routing, and a tenant-wide fallback must not
    -- second-guess it.
    select pd.copies into _copies
      from public.printer_documents pd
     where pd.printer_id = _printer and pd.doc = _doc;

    insert into public.print_jobs (
      tenant_id, printer_id, doc, kot_id, order_id, branch_id, copies, idempotency_key
    )
    select new.tenant_id, _printer, _doc, new.id, new.order_id, _branch,
           coalesce(_copies, 1), _doc::text || ':' || new.id::text || ':' || _printer::text
     where exists (select 1 from public.printers p where p.id = _printer and p.is_active)
    on conflict do nothing;
  else
    insert into public.print_jobs (
      tenant_id, printer_id, doc, kot_id, order_id, branch_id, copies, idempotency_key
    )
    select new.tenant_id, p.id, _doc, new.id, new.order_id, _branch, pd.copies,
           _doc::text || ':' || new.id::text || ':' || p.id::text
      from public.printer_documents pd
      join public.printers p on p.id = pd.printer_id
     where pd.tenant_id = new.tenant_id
       and pd.doc = _doc
       and p.is_active
       and (_branch is null or p.branch_id is null or p.branch_id = _branch)
    on conflict do nothing;
  end if;

  -- The consolidated pass ticket is per order, not per station, so its key
  -- carries the order id — later stations firing into the same order find the
  -- key taken and add nothing.
  insert into public.print_jobs (
    tenant_id, printer_id, doc, order_id, branch_id, copies, idempotency_key
  )
  select new.tenant_id, p.id, 'full_kot', new.order_id, _branch, pd.copies,
         'full_kot:' || new.order_id::text || ':' || p.id::text
    from public.printer_documents pd
    join public.printers p on p.id = pd.printer_id
   where pd.tenant_id = new.tenant_id
     and pd.doc = 'full_kot'
     and p.is_active
     and (_branch is null or p.branch_id is null or p.branch_id = _branch)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_kots_enqueue_print on public.kots;
create trigger trg_kots_enqueue_print after insert on public.kots
  for each row execute function public.enqueue_kot_print();

create or replace function public.enqueue_bill_print()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Settled, not created: a receipt for a bill nobody has paid is waste paper.
  if new.status <> 'paid' or old.status = 'paid' then
    return new;
  end if;

  insert into public.print_jobs (
    tenant_id, printer_id, doc, bill_id, branch_id, copies, idempotency_key
  )
  select new.tenant_id, p.id, 'bill', new.id, new.branch_id, pd.copies,
         'bill:' || new.id::text || ':' || p.id::text
    from public.printer_documents pd
    join public.printers p on p.id = pd.printer_id
   where pd.tenant_id = new.tenant_id
     and pd.doc = 'bill'
     and p.is_active
     and (new.branch_id is null or p.branch_id is null or p.branch_id = new.branch_id)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists trg_bills_enqueue_print on public.bills;
create trigger trg_bills_enqueue_print after update of status on public.bills
  for each row execute function public.enqueue_bill_print();

-- ---------------------------------------------------------------------------
-- Grants. A new argument list is a new function object, so every signature is
-- named in full — old grants do not carry over, and `public` holds EXECUTE by
-- default.
-- ---------------------------------------------------------------------------

revoke execute on function public.save_printer(uuid, uuid, text, public.printer_connection, text, integer, text, text, text, integer, public.printer_render_mode, boolean, boolean, uuid, boolean, jsonb) from public, anon;
revoke execute on function public.delete_printer(uuid) from public, anon;
revoke execute on function public.set_station_printer(uuid, uuid) from public, anon;
revoke execute on function public.set_station_kind(uuid, public.station_kind) from public, anon;
revoke execute on function public.set_printing_mode(uuid, text) from public, anon;
revoke execute on function public.set_printer_usb_path(uuid, text, text) from public, anon;
revoke execute on function public.enqueue_print_job(uuid, public.print_doc, uuid, uuid, uuid, uuid, integer, text) from public, anon;
revoke execute on function public.claim_print_jobs(uuid, uuid, text, integer) from public, anon;
revoke execute on function public.complete_print_job(uuid, public.print_job_status, text) from public, anon;
revoke execute on function public.retry_print_job(uuid) from public, anon;
-- Trigger functions are reached through the trigger, never called directly.
revoke execute on function public.enqueue_kot_print() from public, anon, authenticated;
revoke execute on function public.enqueue_bill_print() from public, anon, authenticated;

grant execute on function public.save_printer(uuid, uuid, text, public.printer_connection, text, integer, text, text, text, integer, public.printer_render_mode, boolean, boolean, uuid, boolean, jsonb) to authenticated;
grant execute on function public.delete_printer(uuid) to authenticated;
grant execute on function public.set_station_printer(uuid, uuid) to authenticated;
grant execute on function public.set_station_kind(uuid, public.station_kind) to authenticated;
grant execute on function public.set_printing_mode(uuid, text) to authenticated;
grant execute on function public.set_printer_usb_path(uuid, text, text) to authenticated;
grant execute on function public.enqueue_print_job(uuid, public.print_doc, uuid, uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.claim_print_jobs(uuid, uuid, text, integer) to authenticated;
grant execute on function public.complete_print_job(uuid, public.print_job_status, text) to authenticated;
grant execute on function public.retry_print_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: a queued job has to reach a listening tab without polling.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'print_jobs'
  ) then
    alter publication supabase_realtime add table public.print_jobs;
  end if;
end $$;

alter table public.print_jobs replica identity full;
