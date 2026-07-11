-- ============================================================================
-- Lock down SECURITY DEFINER function execution.
-- `revoke ... from anon` (in 20260710095505 / 100019) was ineffective: Postgres
-- grants EXECUTE to PUBLIC by default, so anon still qualified via PUBLIC. Revoke
-- from PUBLIC and grant only authenticated. (No prior hole — each function guards
-- on auth.uid() internally — but this matches intent and clears advisor 0028.)
-- ============================================================================

revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.current_tenant_ids() from public;
revoke execute on function public.has_tenant_role(uuid, public.app_role[]) from public;
revoke execute on function public.provision_tenant(text, text, text) from public;
revoke execute on function public.apply_tenant_rls(regclass) from public;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.current_tenant_ids() to authenticated;
grant execute on function public.has_tenant_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.provision_tenant(text, text, text) to authenticated;
-- apply_tenant_rls is migration-time only — no runtime grant.
