-- ============================================================================
-- Business-day cutoff — when the trading day turns over.
--
-- A restaurant's day does not end at midnight. A sale rung at 01:30 belongs to
-- the night before, and every surface that buckets by day (POS Completed tab,
-- Reports, the new day-close sheet) has to agree on that or the numbers stop
-- reconciling. `day_cutoff_minutes` is that one number, per tenant.
--
-- SAFETY: with day_cutoff_minutes = 0 (the default, and what every existing
-- tenant gets) the new tenant_day_start body reduces to
--     ((business_day(_at,_tz,0)::timestamp + interval '0 min') at time zone _tz)
--   = (((_at at time zone _tz) - interval '0 min')::date::timestamp) at time zone _tz
--   = ((_at at time zone _tz)::date)::timestamp at time zone _tz
-- which is byte-identical to the previous body. Zero cutoff = zero behaviour
-- change. Verified against all live tenants before and after.
--
-- CROSS-CLIENT, deliberately: Flutter calls tenant_day_start (pos_repository,
-- bill_providers, completed_tab). A tenant that sets a 4am cutoff gets it on the
-- phone too, with no Dart change. That is precisely why this boundary lives in
-- SQL rather than being re-implemented per client (CLAUDE.md rule 1).
--
-- tenant_day_start keeps its EXACT 2-arg signature — a plain create-or-replace,
-- so grants carry over and no caller has to change.
-- ============================================================================

alter table public.tenant_settings
  add column if not exists day_cutoff_minutes integer not null default 0;

alter table public.tenant_settings
  drop constraint if exists tenant_settings_day_cutoff_check;

-- Capped below 720: a cutoff past noon stops meaning "late night" and starts
-- being ambiguous about which day a lunch service belongs to.
alter table public.tenant_settings
  add constraint tenant_settings_day_cutoff_check
  check (day_cutoff_minutes >= 0 and day_cutoff_minutes < 720);

comment on column public.tenant_settings.day_cutoff_minutes is
  'Minutes after local midnight at which the trading day turns over. 240 = 4am: a sale at 01:30 belongs to the previous business day. 0 = tenant midnight (the pre-existing behaviour).';

-- The boundary rule, expressed once. Everything else calls this.
create or replace function public.business_day(
  _at timestamptz,
  _tz text,
  _cutoff_min integer
)
returns date
language sql
immutable
set search_path = public
as $$
  select (((_at at time zone coalesce(_tz, 'UTC'))
           - make_interval(mins => coalesce(_cutoff_min, 0)))::date);
$$;

revoke execute on function public.business_day(timestamptz, text, integer)
  from public, anon;
grant execute on function public.business_day(timestamptz, text, integer)
  to authenticated;

create or replace function public.tenant_day_start(
  _tenant uuid,
  _at timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tz text;
  _cut integer;
begin
  if _tenant not in (select public.current_tenant_ids())
     and not public.is_platform_admin() then
    raise exception 'not a member of this restaurant' using errcode = '42501';
  end if;

  select coalesce(s.timezone, 'UTC'), coalesce(s.day_cutoff_minutes, 0)
    into _tz, _cut
  from public.tenant_settings s
  where s.tenant_id = _tenant;

  _tz := coalesce(_tz, 'UTC');
  _cut := coalesce(_cut, 0);

  -- Start of the current business day, back in UTC. Not date_trunc('day', _at)
  -- — that truncates in UTC and puts the boundary five and three-quarter hours
  -- out in Kathmandu, which is the middle of dinner service.
  return ((public.business_day(_at, _tz, _cut)::timestamp
           + make_interval(mins => _cut)) at time zone _tz);
end;
$$;

revoke execute on function public.tenant_day_start(uuid, timestamptz)
  from public, anon;
grant execute on function public.tenant_day_start(uuid, timestamptz)
  to authenticated;
