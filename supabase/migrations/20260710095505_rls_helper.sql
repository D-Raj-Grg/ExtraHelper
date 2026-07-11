-- Standard tenant-isolation policy applier (applied via MCP as migration rls_helper).
-- See 20260710095343_foundation.sql for helper fns it depends on.
create or replace function public.apply_tenant_rls(_table regclass)
returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', _table);
  execute format(
    'create policy tenant_all on %s for all to authenticated '
    'using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin()) '
    'with check (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())',
    _table);
end $$;
