-- ============================================================================
-- Lock down fire_order + apply_tenant_rls execution.
-- Supabase's default privileges GRANT EXECUTE directly to `anon` (and
-- `authenticated`) on every new function, so `revoke ... from public` (in the
-- fire_order migration) left the direct anon grant intact. Revoke from anon
-- explicitly. (No live hole — fire_order authorizes on membership, apply_tenant_rls
-- runs as invoker — but this restores least-privilege + clears advisor 0028.)
-- ============================================================================

revoke execute on function public.fire_order(uuid) from anon, public;
grant execute on function public.fire_order(uuid) to authenticated;

-- apply_tenant_rls is migration-time only (runs as the owner); no runtime caller.
revoke execute on function public.apply_tenant_rls(regclass) from anon, authenticated, public;
