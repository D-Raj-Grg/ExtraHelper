-- Members without an explicit role_id used to resolve against the hardcoded
-- default_role_permissions() list, which meant editing a tenant's default role
-- had no effect on them. Resolve through the tenant's own system role for that
-- base role first; the hardcoded list stays as the last-resort fallback.

create or replace function public.has_permission(_tenant uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = _tenant and ut.status = 'active'
      and (
        (ut.role_id is not null and exists (
           select 1 from public.role_permissions rp where rp.role_id = ut.role_id and rp.permission_key = _key))
        or (ut.role_id is null and exists (
           select 1 from public.roles r
           join public.role_permissions rp on rp.role_id = r.id
           where r.tenant_id = ut.tenant_id and r.is_system and r.base_role = ut.role
             and rp.permission_key = _key))
        or (ut.role_id is null
            and not exists (select 1 from public.roles r
                            where r.tenant_id = ut.tenant_id and r.is_system and r.base_role = ut.role)
            and exists (select 1 from public.default_role_permissions(ut.role) k where k = _key))
      )
  );
$$;
grant execute on function public.has_permission(uuid, text) to authenticated;

create or replace function public.get_my_permissions(_tenant uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select key from public.permissions where public.is_platform_admin()
  union
  select rp.permission_key
  from public.user_tenants ut
  join public.role_permissions rp on rp.role_id = ut.role_id
  where ut.user_id = auth.uid() and ut.tenant_id = _tenant and ut.status = 'active' and ut.role_id is not null
  union
  select rp.permission_key
  from public.user_tenants ut
  join public.roles r on r.tenant_id = ut.tenant_id and r.is_system and r.base_role = ut.role
  join public.role_permissions rp on rp.role_id = r.id
  where ut.user_id = auth.uid() and ut.tenant_id = _tenant and ut.status = 'active' and ut.role_id is null
  union
  select k
  from public.user_tenants ut, public.default_role_permissions(ut.role) k
  where ut.user_id = auth.uid() and ut.tenant_id = _tenant and ut.status = 'active' and ut.role_id is null
    and not exists (select 1 from public.roles r
                    where r.tenant_id = ut.tenant_id and r.is_system and r.base_role = ut.role);
$$;
grant execute on function public.get_my_permissions(uuid) to authenticated;
