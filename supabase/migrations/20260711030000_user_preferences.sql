-- Per-user UI preferences (theme + text size). Distinct from per-tenant
-- tenant_settings: these follow the individual across devices/tenants.
create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  theme      text     not null default 'light' check (theme in ('light', 'dark')),
  text_scale smallint not null default 2 check (text_scale between 0 and 4),
  updated_at timestamptz not null default now()
);

create trigger trg_user_preferences_updated before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- RLS: a user may only see/modify their own row.
alter table public.user_preferences enable row level security;

create policy user_preferences_self on public.user_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_preferences to authenticated;
