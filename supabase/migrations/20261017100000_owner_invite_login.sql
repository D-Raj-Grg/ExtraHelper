-- Let an owner create the login for an Owner-role invite.
--
-- assert_can_create_invite_login used to refuse base_role = 'owner' ("owners
-- must sign up themselves"). That blocked inviting a co-owner who has no
-- reachable inbox. Safe to relax here because the invite path only ever
-- creates a brand-new account: the function still refuses when an account
-- with that email exists, so it cannot be used to take over someone's login.
-- Setting an existing owner's password stays blocked in
-- assert_can_set_member_password.

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
  if exists (select 1 from auth.users where lower(email) = _mail) then
    raise exception 'an account already exists for this email — add them again to attach it' using errcode = '23505';
  end if;
  return _si;
end $$;
