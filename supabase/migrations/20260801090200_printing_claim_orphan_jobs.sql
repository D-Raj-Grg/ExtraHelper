-- Follow-up to `20260801090100_printing_bluetooth`, caught by re-reading the
-- filter rather than by anything failing.
--
-- `print_jobs.printer_id` is `on delete set null`. Delete a printer that still
-- has something queued and the job survives with no printer — matching no
-- connection and no render mode, so under the new capability filter *nothing*
-- could claim it. It would have sat on the queue forever, invisible, where
-- before it was claimed and failed with "no printer" for someone to see.
--
-- A null printer is now anybody's to take. The drainer fails it with a message,
-- which is the outcome that existed before the filter.
--
-- Same arity as `20260801090100`, so this is a genuine `create or replace` and
-- the existing grants carry over. `20260801090100` already contains this body;
-- the file exists so the applied ledger and the repository tell the same story.

create or replace function public.claim_print_jobs(
  _tenant       uuid,
  _branch       uuid,
  _claimer      text,
  _limit        integer,
  _connections  text[] default null,
  _render_modes text[] default null
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
        and (
          (_connections is null and _render_modes is null)
          or c.printer_id is null
          or exists (
            select 1 from public.printers p
             where p.id = c.printer_id
               and (_connections is null or p.connection::text = any(_connections))
               and (_render_modes is null or p.render_mode::text = any(_render_modes))
          )
        )
      order by c.created_at
      for update skip locked
      limit greatest(1, least(25, coalesce(_limit, 5)))
   )
  returning j.*;
end $$;
