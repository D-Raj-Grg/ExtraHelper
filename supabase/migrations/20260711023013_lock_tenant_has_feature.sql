-- tenant_has_feature is server-side only (feature guards); no anon need.
-- The default anon EXECUTE grant on creation was never revoked. Lock it.
revoke execute on function public.tenant_has_feature(uuid, text) from anon, public;
grant execute on function public.tenant_has_feature(uuid, text) to authenticated;
