-- ============================================================================
-- Hardening from security advisors (all WARN, no ERROR).
-- ============================================================================

-- Pin search_path on remaining functions (advisor 0011).
alter function public.set_updated_at() set search_path = public;
alter function public.apply_tenant_rls(regclass) set search_path = public;

-- RLS helpers are only invoked by `to authenticated` policies; anon never needs
-- direct RPC access. Revoke to clear advisor 0028. The authenticated grant stays
-- (policies require it; fns only reveal data about the calling user, auth.uid()).
revoke execute on function public.is_platform_admin() from anon;
revoke execute on function public.current_tenant_ids() from anon;
revoke execute on function public.has_tenant_role(uuid, public.app_role[]) from anon;
