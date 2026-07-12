-- ============================================================================
-- Permission resolution + team management RPCs. SECURITY DEFINER (read auth.users
-- for emails; enforce owner/manager + last-owner guards inside).
-- ============================================================================

-- True if the caller has permission _key in tenant (role_permissions, or the
-- base-role default when they have no custom role). Platform admin → always.
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
           select 1 from public.default_role_permissions(ut.role) k where k = _key))
      )
  );
$$;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- The caller's full permission-key set for a tenant (for hydrating the client).
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
  select k
  from public.user_tenants ut, public.default_role_permissions(ut.role) k
  where ut.user_id = auth.uid() and ut.tenant_id = _tenant and ut.status = 'active' and ut.role_id is null;
$$;
grant execute on function public.get_my_permissions(uuid) to authenticated;

-- Roster (members + pending invites) with emails.
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
    and (public.has_tenant_role(_tenant, 'owner', 'manager') or public.is_platform_admin())
  union all
  select null::uuid, si.email, si.base_role, si.role_id, r.name, 'invited', si.created_at
  from public.staff_invites si
  left join public.roles r on r.id = si.role_id
  where si.tenant_id = _tenant
    and (public.has_tenant_role(_tenant, 'owner', 'manager') or public.is_platform_admin())
  order by created_at;
$$;
grant execute on function public.list_tenant_members(uuid) to authenticated;

-- Add a member by email → attach existing account, else create a pending invite.
create or replace function public.add_member_by_email(_tenant uuid, _email text, _role_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare _base public.app_role; _uid uuid; _mail text := lower(trim(_email));
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _mail = '' then raise exception 'email required' using errcode = '22023'; end if;
  select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
  if _base is null then raise exception 'invalid role' using errcode = '22023'; end if;
  if _base = 'owner' and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can assign the owner role' using errcode = '42501';
  end if;

  select id into _uid from auth.users where lower(email) = _mail limit 1;
  if _uid is not null then
    if exists (select 1 from public.user_tenants where user_id = _uid and tenant_id = _tenant) then
      raise exception 'already a member' using errcode = '23505';
    end if;
    insert into public.user_tenants (user_id, tenant_id, role, role_id, status)
    values (_uid, _tenant, _base, _role_id, 'active');
    return 'added';
  else
    insert into public.staff_invites (tenant_id, email, role_id, base_role, invited_by)
    values (_tenant, _mail, _role_id, _base, auth.uid())
    on conflict (tenant_id, email) do update set role_id = excluded.role_id, base_role = excluded.base_role;
    return 'invited';
  end if;
end $$;
grant execute on function public.add_member_by_email(uuid, text, uuid) to authenticated;

-- Change a member's role (base_role follows the role). Last-owner guarded.
create or replace function public.set_member_role(_tenant uuid, _user_id uuid, _role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _base public.app_role; _cur public.app_role; _owners int;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
  if _base is null then raise exception 'invalid role' using errcode = '22023'; end if;
  if _base = 'owner' and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can assign the owner role' using errcode = '42501';
  end if;

  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  select count(*) into _owners from public.user_tenants where tenant_id = _tenant and role = 'owner';
  if _cur = 'owner' and _base <> 'owner' and _owners <= 1 then
    raise exception 'cannot demote the last owner' using errcode = '42501';
  end if;

  update public.user_tenants set role = _base, role_id = _role_id
  where tenant_id = _tenant and user_id = _user_id;
end $$;
grant execute on function public.set_member_role(uuid, uuid, uuid) to authenticated;

-- Approve a pending signup.
create or replace function public.approve_member(_tenant uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.user_tenants set status = 'active'
  where tenant_id = _tenant and user_id = _user_id and status = 'pending';
end $$;
grant execute on function public.approve_member(uuid, uuid) to authenticated;

-- Remove a member. Cannot remove yourself or the last owner.
create or replace function public.remove_member(_tenant uuid, _user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _cur public.app_role; _owners int;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'you cannot remove yourself' using errcode = '42501';
  end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur is null then return; end if;
  select count(*) into _owners from public.user_tenants where tenant_id = _tenant and role = 'owner';
  if _cur = 'owner' and _owners <= 1 then
    raise exception 'cannot remove the last owner' using errcode = '42501';
  end if;
  delete from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
end $$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Cancel a pending (no-account) invite.
create or replace function public.cancel_invite(_tenant uuid, _email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.staff_invites where tenant_id = _tenant and email = lower(trim(_email));
end $$;
grant execute on function public.cancel_invite(uuid, text) to authenticated;

-- Claim any pending invite for a just-signed-up user (called from the app after
-- auth). Creates a PENDING membership (owner/manager approves), removes invite.
create or replace function public.claim_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _uid uuid := auth.uid(); _mail text; _si record;
begin
  if _uid is null then return; end if;
  select lower(email) into _mail from auth.users where id = _uid;
  if _mail is null then return; end if;
  for _si in select * from public.staff_invites where email = _mail loop
    insert into public.user_tenants (user_id, tenant_id, role, role_id, status)
    values (_uid, _si.tenant_id, _si.base_role, _si.role_id, 'pending')
    on conflict (user_id, tenant_id) do nothing;
    delete from public.staff_invites where id = _si.id;
  end loop;
end $$;
grant execute on function public.claim_invites() to authenticated;
