-- ============================================================================
-- tenant_day_start — where a tenant's trading day begins, in its own timezone.
--
-- The web computes this in TypeScript (`tzDayStart`, lib/format.ts) and feeds it
-- to the Completed tab and the KOT tail. Flutter cannot copy that: `package:intl`
-- carries no IANA timezone database, so the same arithmetic in Dart would need a
-- new dependency AND a second implementation of a boundary that decides which
-- orders a waiter can see — the drift CLAUDE.md rule 1 forbids. Postgres already
-- owns `tenant_settings.timezone`, exactly as `dashboard_summary` argued.
--
-- SECURITY DEFINER because it reads `tenant_settings`, which a waiter role has
-- no business selecting wholesale; membership is checked here instead. Returns
-- the UTC instant of local midnight, so callers compare it against `created_at`
-- directly.
-- ============================================================================

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
begin
  if _tenant not in (select public.current_tenant_ids())
     and not public.is_platform_admin() then
    raise exception 'not a member of this restaurant' using errcode = '42501';
  end if;

  select coalesce(s.timezone, 'UTC') into _tz
  from public.tenant_settings s
  where s.tenant_id = _tenant;

  _tz := coalesce(_tz, 'UTC');

  -- Local midnight, back in UTC. Not `date_trunc('day', _at)` — that truncates
  -- in UTC and puts the boundary five and three-quarter hours out in Kathmandu,
  -- which is the middle of dinner service.
  return ((_at at time zone _tz)::date)::timestamp at time zone _tz;
end;
$$;

-- `public` holds EXECUTE by default, and revoking from anon alone does nothing.
revoke execute on function public.tenant_day_start(uuid, timestamptz)
  from public, anon;
grant execute on function public.tenant_day_start(uuid, timestamptz)
  to authenticated;
