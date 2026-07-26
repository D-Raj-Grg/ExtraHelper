-- Review fix #1: don't expose every user's profile globally. A user may read
-- their own profile, profiles of people who share a tenant with them, and
-- platform admins may read all.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.user_tenants me
      join public.user_tenants them on them.tenant_id = me.tenant_id
      where me.user_id = auth.uid() and them.user_id = public.profiles.id
    )
  );

-- Review fix #3: guarantee a profile row exists even if the default @handle
-- collides (concurrent signup) — fall back to a null username.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _base text; _handle text; _n int := 0;
begin
  _base := regexp_replace(lower(split_part(coalesce(new.email, 'user'), '@', 1)), '[^a-z0-9_]', '', 'g');
  if coalesce(_base, '') = '' then _base := 'user'; end if;
  _handle := _base;
  while exists (select 1 from public.profiles where lower(username) = lower(_handle)) loop
    _n := _n + 1;
    _handle := _base || _n::text;
  end loop;
  begin
    insert into public.profiles (id, full_name, username)
    values (new.id, nullif(trim(new.raw_user_meta_data->>'full_name'), ''), _handle)
    on conflict (id) do nothing;
  exception when unique_violation then
    begin
      insert into public.profiles (id, full_name, username)
      values (new.id, nullif(trim(new.raw_user_meta_data->>'full_name'), ''), null)
      on conflict (id) do nothing;
    exception when others then null;
    end;
  when others then null;
  end;
  return new;
end $function$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
