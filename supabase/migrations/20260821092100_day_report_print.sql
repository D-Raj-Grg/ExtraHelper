-- ============================================================================
-- Queue a day-close (Z) report for the thermal printer.
--
-- print_jobs only carries kot_id / bill_id / order_id as subject refs, and a
-- day report has no subject — it is addressed by a date. Hence business_day.
--
-- A SIBLING of enqueue_print_job rather than a change to it, for two reasons:
-- Flutter calls that function and CLAUDE.md forbids changing an RPC's arity in
-- place; and its permission map falls through to 'settings.edit', which is the
-- wrong gate for a report. This one asks for reports.view, the same key that
-- guards daily_report itself.
--
-- KNOWN DRIFT (web-only change): the Flutter printing screen's hard-coded
-- _docLabels map has no 'day_report' key, so the phone's job list shows a
-- fallback label for these jobs. Non-breaking — the drainer fetches rendered
-- bytes from /api/print/render and prints them fine.
-- ============================================================================

alter table public.print_jobs
  add column if not exists business_day date;

comment on column public.print_jobs.business_day is
  'Which business day a day_report job covers. Null for every other doc, which is addressed by kot_id / bill_id / order_id instead.';

create or replace function public.enqueue_day_report_job(
  _tenant     uuid,
  _printer_id uuid,
  _day        date,
  _copies     integer,
  _idem       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _job uuid;
begin
  if _tenant not in (select public.current_tenant_ids()) then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  if not public.has_permission(_tenant, 'reports.view') then
    raise exception 'not authorized to print this' using errcode = '42501';
  end if;

  -- branch_id stays null on purpose: a day close is the tenant's whole day.
  insert into public.print_jobs (
    tenant_id, printer_id, doc, business_day, copies, idempotency_key
  ) values (
    _tenant, _printer_id, 'day_report', _day,
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

revoke execute on function public.enqueue_day_report_job(uuid, uuid, date, integer, text)
  from public, anon;
grant execute on function public.enqueue_day_report_job(uuid, uuid, date, integer, text)
  to authenticated;
