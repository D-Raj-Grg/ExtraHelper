-- ============================================================================
-- SaaS monetization: subscription plans, per-tenant subscription, feature gating.
-- Plans carry a `features` jsonb (feature flags) + `limits`. subscribe_tenant
-- activates a plan and issues a platform invoice. tenant_has_feature gates
-- features by the tenant's active plan (trial unlocks everything).
-- ============================================================================

-- Seed the three plans (idempotent by unique code).
insert into public.plans (code, name, price_cents, interval, features, limits) values
  ('starter', 'Starter', 0, 'month',
    '{"online_store": false, "loyalty": false, "advanced_reports": false, "multi_branch": false}',
    '{"branches": 1, "staff": 5}'),
  ('pro', 'Pro', 4900, 'month',
    '{"online_store": true, "loyalty": true, "advanced_reports": true, "multi_branch": false}',
    '{"branches": 3, "staff": 25}'),
  ('enterprise', 'Enterprise', 9900, 'month',
    '{"online_store": true, "loyalty": true, "advanced_reports": true, "multi_branch": true}',
    '{"branches": 100, "staff": 500}')
on conflict (code) do update
  set name = excluded.name, price_cents = excluded.price_cents,
      features = excluded.features, limits = excluded.limits;

-- Activate a plan for a tenant + issue an invoice (sandbox = marked paid).
create or replace function public.subscribe_tenant(
  _tenant uuid, _plan_code text, _interval text default 'month'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _plan record; _sub uuid; _period interval; _price integer;
begin
  if not (public.has_tenant_role(_tenant, 'owner') or public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select id, price_cents into _plan from public.plans where code = _plan_code and is_active;
  if _plan.id is null then raise exception 'unknown plan' using errcode = 'P0002'; end if;

  _period := case when _interval = 'year' then interval '1 year' else interval '1 month' end;
  _price := case when _interval = 'year' then _plan.price_cents * 12 else _plan.price_cents end;

  select id into _sub from public.subscriptions where tenant_id = _tenant limit 1;
  if _sub is null then
    insert into public.subscriptions (tenant_id, plan_id, status, current_period_end)
    values (_tenant, _plan.id, 'active', now() + _period) returning id into _sub;
  else
    update public.subscriptions
    set plan_id = _plan.id, status = 'active', current_period_end = now() + _period
    where id = _sub;
  end if;

  insert into public.platform_invoices (tenant_id, subscription_id, amount_cents, status, paid_at)
  values (_tenant, _sub, _price, 'paid', now());

  update public.tenants set status = 'active' where id = _tenant;
  return _sub;
end $$;

-- Feature gate: does the tenant's active plan (or trial) include `_key`?
create or replace function public.tenant_has_feature(_tenant uuid, _key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when s.status = 'trialing' and coalesce(s.trial_ends_at, now() + interval '1 day') > now()
      then true                                        -- trial unlocks everything
    when s.status = 'active' and coalesce(s.current_period_end, now()) > now()
      then coalesce((p.features->>_key)::boolean, false)
    else false
  end
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = _tenant
  order by s.created_at desc
  limit 1;
$$;

revoke execute on function public.subscribe_tenant(uuid, text, text) from anon, public;
grant execute on function public.subscribe_tenant(uuid, text, text) to authenticated;
grant execute on function public.tenant_has_feature(uuid, text) to authenticated;

-- Give the demo tenant an active Pro subscription so gated features are visible.
do $$
declare _pro uuid;
begin
  select id into _pro from public.plans where code = 'pro';
  if not exists (select 1 from public.subscriptions where tenant_id = 'd0000000-0000-0000-0000-000000000001') then
    insert into public.subscriptions (tenant_id, plan_id, status, current_period_end)
    values ('d0000000-0000-0000-0000-000000000001', _pro, 'active', now() + interval '1 month');
  end if;
end $$;
