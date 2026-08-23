-- ============================================================================
-- Gate the team surface on the `staff.view` / `staff.edit` permission keys
-- instead of the `owner`/`manager` base roles.
--
-- Why: the apps gate on `staff.edit`, but every server-side check asked
-- `has_tenant_role(tenant,'owner','manager')`. A custom role with base_role
-- 'waiter' granted `staff.edit` therefore passed the app gate and was then
-- refused by the server -- SILENTLY for the table writes (RLS matches zero
-- rows, PostgREST answers 200 with []) and with a bare 42501 for the RPCs.
-- That made custom roles unusable for anything to do with the team, and it is
-- about to matter more: the Flutter app is growing the same screen.
--
-- The owner-protection guards below are deliberately NOT touched. Who may
-- manage the team and who may create, promote or remove an OWNER are separate
-- questions, and the owner guards are the only thing standing between a
-- `staff.edit` holder and an unrecoverable restaurant.
--
-- Blast radius when written: zero. Across every tenant there were only the 7
-- seeded system roles and no custom roles at all, and no member with a base
-- role outside owner/manager held `staff.edit`. This is a no-op today; it
-- unlocks the future.
--
-- Accepted consequence: `staff.edit` is now the keys to the building -- a
-- holder can edit any role's permission set including their own. That was
-- already true of every manager; this widens who may be GIVEN it, not what it
-- means. Grant it deliberately.
--
-- No recursion: all five tables are owned by `postgres` with
-- relforcerowsecurity = false, and `has_permission` is SECURITY DEFINER, so
-- its own reads of user_tenants / roles / role_permissions bypass RLS. This is
-- the identical mechanism `has_tenant_role` already relied on in these very
-- policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles
  for all to authenticated
  using (public.has_permission(tenant_id, 'staff.edit'))
  with check (public.has_permission(tenant_id, 'staff.edit'));

drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id
      and public.has_permission(r.tenant_id, 'staff.edit')))
  with check (exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id
      and public.has_permission(r.tenant_id, 'staff.edit')));

drop policy if exists user_tenants_manage on public.user_tenants;
create policy user_tenants_manage on public.user_tenants
  for all to authenticated
  using (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin())
  with check (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin());

-- Read: a `staff.view` holder must be able to count people per role. Without
-- this arm the roster arrives through list_tenant_members but the per-role
-- count silently reads as 1 -- the caller's own row.
drop policy if exists user_tenants_self_read on public.user_tenants;
create policy user_tenants_self_read on public.user_tenants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission(tenant_id, 'staff.view')
    or public.is_platform_admin()
  );

drop policy if exists staff_invites_manage on public.staff_invites;
create policy staff_invites_manage on public.staff_invites
  for all to authenticated
  using (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin())
  with check (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin());

drop policy if exists join_codes_manage on public.tenant_join_codes;
create policy join_codes_manage on public.tenant_join_codes
  for all to authenticated
  using (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin())
  with check (public.has_permission(tenant_id, 'staff.edit') or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- RPCs -- only the opening authorisation line changes in each.
-- ---------------------------------------------------------------------------

-- Roster: members + pending signups + invites that have no account yet.
-- Still filters rather than raises, so an unauthorised caller gets zero rows.
create or replace function public.list_tenant_members(_tenant uuid)
returns table (
  user_id uuid, email text, base_role public.app_role,
  role_id uuid, role_name text, status text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select ut.user_id, u.email::text, ut.role, ut.role_id, r.name, ut.status, ut.created_at
  from public.user_tenants ut
  join auth.users u on u.id = ut.user_id
  left join public.roles r on r.id = ut.role_id
  where ut.tenant_id = _tenant
    and (public.has_permission(_tenant, 'staff.view') or public.is_platform_admin())
  union all
  select null::uuid, si.email, si.base_role, si.role_id, r.name, 'invited', si.created_at
  from public.staff_invites si
  left join public.roles r on r.id = si.role_id
  where si.tenant_id = _tenant
    and (public.has_permission(_tenant, 'staff.view') or public.is_platform_admin())
  order by created_at;
$$;
grant execute on function public.list_tenant_members(uuid) to authenticated;

create or replace function public.add_member_by_email(_tenant uuid, _email text, _role_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare _base public.app_role; _uid uuid; _mail text := lower(trim(_email));
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  if _mail = '' then raise exception 'email required' using errcode = '22023'; end if;
  select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
  if _base is null then raise exception 'invalid role' using errcode = '22023'; end if;
  if _base = 'owner' and not public.has_tenant_role(_tenant, 'owner') then raise exception 'only an owner can assign the owner role' using errcode = '42501'; end if;
  select id into _uid from auth.users where lower(email) = _mail limit 1;
  if _uid is not null then
    if exists (select 1 from public.user_tenants where user_id = _uid and tenant_id = _tenant) then raise exception 'already a member' using errcode = '23505'; end if;
    insert into public.user_tenants (user_id, tenant_id, role, role_id, status) values (_uid, _tenant, _base, _role_id, 'active');
    return 'added';
  else
    insert into public.staff_invites (tenant_id, email, role_id, base_role, invited_by)
    values (_tenant, _mail, _role_id, _base, auth.uid())
    on conflict (tenant_id, email) do update set role_id = excluded.role_id, base_role = excluded.base_role;
    return 'invited';
  end if;
end $$;
grant execute on function public.add_member_by_email(uuid, text, uuid) to authenticated;

create or replace function public.set_member_role(_tenant uuid, _user_id uuid, _role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _base public.app_role; _cur public.app_role; _owners int;
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
  if _base is null then raise exception 'invalid role' using errcode = '22023'; end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  if (_cur = 'owner' or _base = 'owner') and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can modify an owner' using errcode = '42501';
  end if;
  select count(*) into _owners from public.user_tenants where tenant_id = _tenant and role = 'owner';
  if _cur = 'owner' and _base <> 'owner' and _owners <= 1 then raise exception 'cannot demote the last owner' using errcode = '42501'; end if;
  update public.user_tenants set role = _base, role_id = _role_id where tenant_id = _tenant and user_id = _user_id;
end $$;
grant execute on function public.set_member_role(uuid, uuid, uuid) to authenticated;

create or replace function public.approve_member(_tenant uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _cur public.app_role;
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur = 'owner' and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can approve an owner' using errcode = '42501';
  end if;
  update public.user_tenants set status = 'active' where tenant_id = _tenant and user_id = _user_id and status = 'pending';
end $$;
grant execute on function public.approve_member(uuid, uuid) to authenticated;

create or replace function public.remove_member(_tenant uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _cur public.app_role; _owners int;
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  if _user_id = auth.uid() then raise exception 'you cannot remove yourself' using errcode = '42501'; end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur is null then return; end if;
  if _cur = 'owner' and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can remove an owner' using errcode = '42501';
  end if;
  select count(*) into _owners from public.user_tenants where tenant_id = _tenant and role = 'owner';
  if _cur = 'owner' and _owners <= 1 then raise exception 'cannot remove the last owner' using errcode = '42501'; end if;
  delete from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
end $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

create or replace function public.cancel_invite(_tenant uuid, _email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  delete from public.staff_invites where tenant_id = _tenant and email = lower(trim(_email));
end $$;
grant execute on function public.cancel_invite(uuid, text) to authenticated;

create or replace function public.create_join_code(_tenant uuid, _role_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare _code text; _base public.app_role := 'waiter';
begin
  if not public.has_permission(_tenant, 'staff.edit') then raise exception 'not authorized' using errcode = '42501'; end if;
  if _role_id is not null then
    select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
    if _base is null then raise exception 'role not found' using errcode = 'P0002'; end if;
  end if;
  loop
    _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.tenant_join_codes where code = _code);
  end loop;
  insert into public.tenant_join_codes (tenant_id, code, base_role, role_id, created_by)
  values (_tenant, _code, _base, _role_id, auth.uid());
  return _code;
end $$;
grant execute on function public.create_join_code(uuid, uuid) to authenticated;
