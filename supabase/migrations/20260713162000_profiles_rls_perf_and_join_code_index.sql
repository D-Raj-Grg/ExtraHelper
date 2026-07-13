-- Perf hygiene on new tables (Supabase advisors): wrap auth.uid() in a scalar
-- subselect so it's evaluated once per query not per row (auth_rls_initplan),
-- split self-write off SELECT to remove the overlapping permissive policy, and
-- index the join-code role FK.

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_self_write on public.profiles;

create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1 from public.user_tenants me
      join public.user_tenants them on them.tenant_id = me.tenant_id
      where me.user_id = (select auth.uid()) and them.user_id = public.profiles.id
    )
  );

create policy profiles_self_insert on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_self_delete on public.profiles
  for delete to authenticated using (id = (select auth.uid()));

create index if not exists idx_tenant_join_codes_role on public.tenant_join_codes(role_id);
