-- Security hardening (commit review):
-- 1. Only claim invites when the caller's email is verified (no takeover via an
--    unowned/unverified email). 2. Only an owner may modify/remove/approve an
--    owner member (managers cannot escalate against owners).

create or replace function public.claim_invites()
returns void language plpgsql security definer set search_path = public
as $$
declare _uid uuid := auth.uid(); _mail text; _si record;
begin
  if _uid is null then return; end if;
  -- Verified email only — prevents claiming an invite for an address you don't own.
  select lower(email) into _mail from auth.users where id = _uid and email_confirmed_at is not null;
  if _mail is null then return; end if;
  for _si in select * from public.staff_invites where email = _mail loop
    insert into public.user_tenants (user_id, tenant_id, role, role_id, status)
    values (_uid, _si.tenant_id, _si.base_role, _si.role_id, 'pending')
    on conflict (user_id, tenant_id) do nothing;
    delete from public.staff_invites where id = _si.id;
  end loop;
end $$;
grant execute on function public.claim_invites() to authenticated;

create or replace function public.set_member_role(_tenant uuid, _user_id uuid, _role_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare _base public.app_role; _cur public.app_role; _owners int;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
  if _base is null then raise exception 'invalid role' using errcode = '22023'; end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  -- Only an owner may touch an owner, or assign the owner role.
  if (_cur = 'owner' or _base = 'owner') and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can modify an owner' using errcode = '42501';
  end if;
  select count(*) into _owners from public.user_tenants where tenant_id = _tenant and role = 'owner';
  if _cur = 'owner' and _base <> 'owner' and _owners <= 1 then raise exception 'cannot demote the last owner' using errcode = '42501'; end if;
  update public.user_tenants set role = _base, role_id = _role_id where tenant_id = _tenant and user_id = _user_id;
end $$;
grant execute on function public.set_member_role(uuid, uuid, uuid) to authenticated;

create or replace function public.remove_member(_tenant uuid, _user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare _cur public.app_role; _owners int;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'not authorized' using errcode = '42501'; end if;
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

create or replace function public.approve_member(_tenant uuid, _user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare _cur public.app_role;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'not authorized' using errcode = '42501'; end if;
  select role into _cur from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _cur = 'owner' and not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can approve an owner' using errcode = '42501';
  end if;
  update public.user_tenants set status = 'active' where tenant_id = _tenant and user_id = _user_id and status = 'pending';
end $$;
grant execute on function public.approve_member(uuid, uuid) to authenticated;
