-- Allow a platform admin to write audit rows against tenants they are not a
-- member of (needed to audit impersonation start/stop, plan/status changes).
-- Still requires actor_id = the caller.
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (
    (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())
    and actor_id = auth.uid()
  );
