-- Printing v2 follow-up: make the queue functions agree with the rest of the
-- module about who a platform admin is.
--
-- `save_printer`, `delete_printer` and the station setters gate on
-- `has_permission`, which carries an `is_platform_admin()` escape — as does
-- `apply_tenant_rls` and every other policy in the schema. The queue functions
-- gated on bare `current_tenant_ids()` instead, so a platform admin
-- impersonating a restaurant (an audited support feature) could add and
-- re-point its printers but got 42501 the moment they pressed Test print,
-- which is exactly the thing a support engineer is impersonating in order to
-- diagnose.
--
-- Tenant isolation for ordinary members is unchanged and was verified before
-- and after: a member of one restaurant calling any of these against another
-- is refused with 42501, and `tenant_limit` returns null.

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
  if _tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin() then
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

create or replace function public.claim_print_jobs(
  _tenant uuid, _branch uuid, _claimer text, _limit integer
)
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if _tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin() then
    raise exception 'unknown restaurant' using errcode = '42501';
  end if;

  -- A tab that claimed a job and was then closed must not strand it.
  update public.print_jobs
     set status = 'queued', claimed_at = null, claimed_by = null
   where tenant_id = _tenant
     and status = 'claimed'
     and claimed_at < now() - interval '60 seconds';

  -- `for update skip locked` is the whole trick: a second POS tab or a second
  -- agent asking at the same moment steps over the locked rows instead of
  -- queueing behind them, so nobody waits and nobody prints a duplicate.
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
  if _tenant is null
     or (_tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin()) then
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

create or replace function public.retry_print_job(_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.print_jobs where id = _job_id;
  if _tenant is null
     or (_tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin()) then
    raise exception 'unknown print job' using errcode = 'P0002';
  end if;

  update public.print_jobs
     set status = 'queued', error = null, claimed_at = null, claimed_by = null
   where id = _job_id and tenant_id = _tenant;
end $$;

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
  if _tenant is null
     or (_tenant not in (select public.current_tenant_ids()) and not public.is_platform_admin()) then
    raise exception 'printer not found' using errcode = 'P0002';
  end if;

  update public.printers
     set usb_interface = _interface, usb_endpoint = _endpoint
   where id = _printer_id and tenant_id = _tenant;
end $$;

-- Same arity throughout, so the existing grants carry over. Re-issued anyway:
-- a `create or replace` that ever changes an argument list creates a second
-- function object and silently leaves the old body live.
revoke execute on function public.enqueue_print_job(uuid, public.print_doc, uuid, uuid, uuid, uuid, integer, text) from public, anon;
revoke execute on function public.claim_print_jobs(uuid, uuid, text, integer) from public, anon;
revoke execute on function public.complete_print_job(uuid, public.print_job_status, text) from public, anon;
revoke execute on function public.retry_print_job(uuid) from public, anon;
revoke execute on function public.set_printer_usb_path(uuid, text, text) from public, anon;

grant execute on function public.enqueue_print_job(uuid, public.print_doc, uuid, uuid, uuid, uuid, integer, text) to authenticated;
grant execute on function public.claim_print_jobs(uuid, uuid, text, integer) to authenticated;
grant execute on function public.complete_print_job(uuid, public.print_job_status, text) to authenticated;
grant execute on function public.retry_print_job(uuid) to authenticated;
grant execute on function public.set_printer_usb_path(uuid, text, text) to authenticated;
