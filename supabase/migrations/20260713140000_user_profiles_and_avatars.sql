-- Phase 1: user profiles (display name / @username / avatar) + avatars bucket.

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  username   text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Case-insensitive unique handle.
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username)) where username is not null;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
-- Anyone signed in may read display fields (for @handle / member lists); a user
-- writes only their own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_self_write on public.profiles;
create policy profiles_self_write on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Auto-provision a profile row on signup. Never fail the signup transaction.
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
  exception when others then
    null;
  end;
  return new;
end $function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing users (default handle from email).
insert into public.profiles (id, full_name, username)
select u.id,
       nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
       regexp_replace(lower(split_part(coalesce(u.email, 'user'), '@', 1)), '[^a-z0-9_]', '', 'g') || '_' || left(u.id::text, 4)
from auth.users u
on conflict (id) do nothing;

-- Avatars storage bucket (public read; write into own {user_id}/ folder).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public using (bucket_id = 'avatars');
drop policy if exists avatars_self_write on storage.objects;
create policy avatars_self_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_self_update on storage.objects;
create policy avatars_self_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_self_delete on storage.objects;
create policy avatars_self_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
