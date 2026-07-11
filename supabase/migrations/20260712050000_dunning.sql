-- ============================================================================
-- Subscription dunning: mark expired subscriptions past_due, and suspend the
-- tenant after a 7-day grace. tenant_has_feature already gates non-active subs,
-- so past_due immediately loses gated features. Runs daily via pg_cron; also
-- triggerable by a platform admin from /admin.
-- ============================================================================
create extension if not exists pg_cron;

-- Core routine — no auth check (pg_cron runs it as the owner, auth.uid() null).
create or replace function public.run_dunning()
returns table (marked_past_due integer, suspended integer)
language plpgsql
security definer
set search_path = public
as $$
declare _pd integer; _sp integer;
begin
  update public.subscriptions
  set status = 'past_due', updated_at = now()
  where status = 'active' and current_period_end < now();
  get diagnostics _pd = row_count;

  update public.tenants
  set status = 'suspended'
  where status <> 'suspended'
    and id in (
      select tenant_id from public.subscriptions
      where status = 'past_due' and current_period_end < now() - interval '7 days'
    );
  get diagnostics _sp = row_count;

  return query select _pd, _sp;
end $$;

revoke execute on function public.run_dunning() from public, anon, authenticated;

-- Admin-triggerable wrapper (checks platform admin, then runs the routine with
-- owner privileges).
create or replace function public.trigger_dunning()
returns table (marked_past_due integer, suspended integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin only' using errcode = '42501';
  end if;
  return query select * from public.run_dunning();
end $$;

revoke execute on function public.trigger_dunning() from public, anon;
grant execute on function public.trigger_dunning() to authenticated;

-- Daily at 03:00 UTC.
select cron.schedule('dunning-daily', '0 3 * * *', 'select public.run_dunning()');
