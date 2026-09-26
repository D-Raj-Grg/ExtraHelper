-- Owner-managed staff passwords.
--
-- Staff forget passwords mid-shift and many have no reachable inbox, so the
-- owner needs to set one for them from the Team screen. The password write
-- itself needs the service role (auth.admin) and happens in a server action;
-- these two functions are the authorization gate it must pass first, run under
-- the caller's JWT so auth.uid() is the owner asking.
--
-- Setting someone's password is account takeover by design, so the gate is
-- deliberately narrower than staff.edit:
--   * owners only (not staff.edit — a custom role must not grant this)
--   * never an owner (co-owners recover through their own email)
--   * never yourself (use Profile, which asks for nothing we can't verify)
--   * never a platform admin
--   * never an account that belongs to any OTHER restaurant. add_member_by_email
--     attaches any existing account, so without this an owner could add a
--     stranger's email and then set that stranger's password.

create or replace function public.assert_can_set_member_password(_tenant uuid, _user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare _role public.app_role; _mail text;
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can set staff passwords' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then
    raise exception 'change your own password from your profile' using errcode = '42501';
  end if;
  select role into _role from public.user_tenants where tenant_id = _tenant and user_id = _user_id;
  if _role is null then raise exception 'member not found' using errcode = 'P0002'; end if;
  if _role = 'owner' then
    raise exception 'an owner''s password can''t be set by another owner' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins where user_id = _user_id) then
    raise exception 'this account can''t be managed here' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_tenants where user_id = _user_id and tenant_id <> _tenant) then
    raise exception 'this person also works at another restaurant — they must reset their password by email' using errcode = '42501';
  end if;
  select email into _mail from auth.users where id = _user_id;
  return _mail;
end $$;

-- An invite has no account yet. Creating one with a password lets the owner
-- hand over a working login on the spot instead of waiting on a sign-up.
create or replace function public.assert_can_create_invite_login(_tenant uuid, _email text)
returns public.staff_invites
language plpgsql
stable
security definer
set search_path = public
as $$
declare _si public.staff_invites; _mail text := lower(trim(_email));
begin
  if not public.has_tenant_role(_tenant, 'owner') then
    raise exception 'only an owner can create staff logins' using errcode = '42501';
  end if;
  select * into _si from public.staff_invites where tenant_id = _tenant and email = _mail;
  if _si.id is null then raise exception 'invite not found' using errcode = 'P0002'; end if;
  if _si.base_role = 'owner' then
    raise exception 'owners must sign up themselves' using errcode = '42501';
  end if;
  if exists (select 1 from auth.users where lower(email) = _mail) then
    raise exception 'an account already exists for this email — add them again to attach it' using errcode = '23505';
  end if;
  return _si;
end $$;

revoke execute on function public.assert_can_set_member_password(uuid, uuid) from public, anon;
revoke execute on function public.assert_can_create_invite_login(uuid, text) from public, anon;
grant execute on function public.assert_can_set_member_password(uuid, uuid) to authenticated;
grant execute on function public.assert_can_create_invite_login(uuid, text) to authenticated;
