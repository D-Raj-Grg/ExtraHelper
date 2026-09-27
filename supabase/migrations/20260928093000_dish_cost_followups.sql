-- ============================================================================
-- Dish cost → gross profit. Part 4: the review follow-ups.
--
-- 1. Add-ons are costed. modifier_costs(modifier_id pk) holds a direct cost;
--    modifier_ingredients × ingredient cost is the fallback. A sold line's
--    snapshot is now dish/portion cost + Σ add-on cost × qty, recomputed by
--    one function whenever the line's item/variant changes OR an
--    order_item_modifiers row is inserted, changed or removed (add-ons land in
--    a separate insert after the line, so the line trigger alone was too
--    early). An add-on with no cost makes the line uncosted — never 0.
-- 2. Refunds are deducted: gross profit = net sales − refunds − COGS, margin
--    on (net sales − refunds). Refunds are counted by their own created_at,
--    the same way the day report already reports them.
-- 3. Top items allocate the bill-level discount pro rata by line total, so
--    Σ item profit reconciles with the headline on a discounted day.
--    revenue_cents stays the gross line total (unchanged contract);
--    profit_cents uses the discounted figure.
-- 4. Custom roles copied from Owner get profit.view once, so an owner who
--    built a "co-owner" role is not silently locked out of their own numbers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4. Copied-Owner roles
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_id, permission_key)
select r.id, 'profit.view'
from public.roles r
where r.base_role = 'owner'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. Add-on costs
-- ---------------------------------------------------------------------------
create table if not exists public.modifier_costs (
  modifier_id uuid primary key references public.modifiers(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  cost_cents  integer not null check (cost_cents >= 0),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_modifier_costs_tenant on public.modifier_costs(tenant_id);
alter table public.modifier_costs enable row level security;
drop policy if exists modifier_costs_read on public.modifier_costs;
create policy modifier_costs_read on public.modifier_costs for select to authenticated
  using (public.has_permission(tenant_id, 'profit.view'));
revoke all on public.modifier_costs from public, anon, authenticated;
grant select on public.modifier_costs to authenticated;

create or replace function public.effective_modifier_cost_cents(_modifier_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select mc.cost_cents from public.modifier_costs mc where mc.modifier_id = _modifier_id),
    (select round(sum(mi.qty * ii.cost_cents))::integer
       from public.modifier_ingredients mi
       join public.inventory_items ii on ii.id = mi.inventory_item_id
      where mi.modifier_id = _modifier_id
     having count(mi.id) > 0)
  )
  where _modifier_id is not null;
$$;
revoke execute on function public.effective_modifier_cost_cents(uuid)
  from public, anon, authenticated;

-- Full unit cost of a sold line: dish/portion + add-ons. Null if any part is
-- unknown. An order_item_modifiers row whose modifier was deleted
-- (modifier_id null) counts as unknown too.
create or replace function public.order_item_unit_cost_cents(_order_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with line as (
    select oi.item_id, oi.variant_id from public.order_items oi where oi.id = _order_item_id
  ),
  base as (
    select public.effective_item_cost_cents(l.item_id, l.variant_id) as cents
    from line l where l.item_id is not null
  ),
  mods as (
    select bool_and(c.cents is not null) as all_known,
           coalesce(sum(c.cents * m.qty), 0)::bigint as cents
    from public.order_item_modifiers m
    cross join lateral (select public.effective_modifier_cost_cents(m.modifier_id) as cents) c
    where m.order_item_id = _order_item_id
  )
  select case
           when (select cents from base) is null then null
           when (select all_known from mods) is false then null
           else ((select cents from base) + (select cents from mods))::integer
         end;
$$;
revoke execute on function public.order_item_unit_cost_cents(uuid)
  from public, anon, authenticated;

create or replace function public.recompute_order_item_cost(_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _c integer;
begin
  select tenant_id into _tenant from public.order_items where id = _order_item_id;
  if _tenant is null then
    return;
  end if;
  _c := public.order_item_unit_cost_cents(_order_item_id);
  if _c is null then
    delete from public.order_item_costs where order_item_id = _order_item_id;
  else
    insert into public.order_item_costs (order_item_id, tenant_id, unit_cost_cents)
    values (_order_item_id, _tenant, _c)
    on conflict (order_item_id) do update
      set unit_cost_cents = excluded.unit_cost_cents, created_at = now();
  end if;
end;
$$;
revoke execute on function public.recompute_order_item_cost(uuid)
  from public, anon, authenticated;

create or replace function public.trg_order_item_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.item_id is not distinct from old.item_id
     and new.variant_id is not distinct from old.variant_id then
    return null;
  end if;
  perform public.recompute_order_item_cost(new.id);
  return null;
end;
$$;
-- trigger definition unchanged (AFTER INSERT OR UPDATE OF item_id, variant_id)

create or replace function public.trg_order_item_modifier_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_order_item_cost(old.order_item_id);
  else
    perform public.recompute_order_item_cost(new.order_item_id);
    if tg_op = 'UPDATE' and new.order_item_id is distinct from old.order_item_id then
      perform public.recompute_order_item_cost(old.order_item_id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.trg_order_item_modifier_cost()
  from public, anon, authenticated;

drop trigger if exists trg_order_item_modifier_cost on public.order_item_modifiers;
create trigger trg_order_item_modifier_cost
  after insert or update or delete on public.order_item_modifiers
  for each row execute function public.trg_order_item_modifier_cost();

create or replace function public.set_modifier_cost(_modifier_id uuid, _cost_cents integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _old integer;
begin
  select tenant_id into _tenant from public.modifiers where id = _modifier_id;
  if _tenant is null then
    raise exception 'add-on not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cost_cents is not null and (_cost_cents < 0 or _cost_cents > 100000000) then
    raise exception 'cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  select cost_cents into _old from public.modifier_costs where modifier_id = _modifier_id;
  if _old is not distinct from _cost_cents then
    return;
  end if;

  if _cost_cents is null then
    delete from public.modifier_costs where modifier_id = _modifier_id;
  else
    insert into public.modifier_costs (modifier_id, tenant_id, cost_cents)
    values (_modifier_id, _tenant, _cost_cents)
    on conflict (modifier_id) do update set cost_cents = excluded.cost_cents, updated_at = now();
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_change', 'modifier', _modifier_id,
          jsonb_build_object('from', _old, 'to', _cost_cents));
end;
$$;

-- Backfill now goes through the same full-line cost.
create or replace function public.backfill_order_item_costs(_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into public.order_item_costs (order_item_id, tenant_id, unit_cost_cents)
  select oi.id, oi.tenant_id, c.cents
  from public.order_items oi
  cross join lateral (select public.order_item_unit_cost_cents(oi.id) as cents) c
  where oi.tenant_id = _tenant
    and oi.item_id is not null
    and c.cents is not null
    and not exists (select 1 from public.order_item_costs x where x.order_item_id = oi.id);
  get diagnostics _n = row_count;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_backfill', 'order_items', null,
          jsonb_build_object('lines', _n));

  return _n;
end;
$$;

do $$
declare _sig text;
begin
  foreach _sig in array array[
    'public.set_modifier_cost(uuid, integer)',
    'public.backfill_order_item_costs(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', _sig);
    execute format('revoke all on function %s from anon', _sig);
    execute format('grant execute on function %s to authenticated', _sig);
  end loop;
end $$;

-- Existing snapshots that have add-ons were stamped without them; re-stamp
-- those lines (and drop the row if an add-on is uncosted) so history follows
-- the same rule as new sales.
select public.recompute_order_item_cost(x.order_item_id)
from (select distinct m.order_item_id
      from public.order_item_modifiers m
      join public.order_item_costs c on c.order_item_id = m.order_item_id) x;

-- ---------------------------------------------------------------------------
-- 2 + 3. Reports. report_sales changes its return type → drop + recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.report_sales(uuid, timestamptz, timestamptz);

create function public.report_sales(
  _tenant uuid,
  _from   timestamptz,
  _to     timestamptz
)
returns table (
  revenue_cents      bigint,
  orders             bigint,
  tax_cents          bigint,
  service_cents      bigint,
  discount_cents     bigint,
  net_sales_cents    bigint,
  refunds_cents      bigint,
  cogs_cents         bigint,
  gross_profit_cents bigint,
  margin_pct         numeric,
  uncosted_lines     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with paid as (
    select b.id, b.total_cents, b.tax_cents, b.service_charge_cents, b.discount_cents, b.subtotal_cents
    from public.bills b
    where b.tenant_id = _tenant
      and b.status = 'paid'
      and b.created_at >= _from
      and b.created_at < _to
      and public.has_permission(_tenant, 'reports.view')
  ),
  cg as (
    select coalesce(sum(bi.qty::bigint * oi.unit_cost_cents), 0)::bigint as cogs_cents,
           count(*) filter (where oi.unit_cost_cents is null)::bigint as uncosted_lines
    from public.bill_items bi
    join paid p on p.id = bi.bill_id
    left join public.order_item_costs oi on oi.order_item_id = bi.order_item_id
  ),
  rf as (
    select coalesce(sum(r.amount_cents), 0)::bigint as refunds_cents
    from public.refunds r
    where r.tenant_id = _tenant
      and r.created_at >= _from and r.created_at < _to
      and public.has_permission(_tenant, 'reports.view')
  ),
  s as (
    select
      coalesce(sum(total_cents), 0)::bigint          as revenue_cents,
      count(*)::bigint                                as orders,
      coalesce(sum(tax_cents), 0)::bigint            as tax_cents,
      coalesce(sum(service_charge_cents), 0)::bigint as service_cents,
      coalesce(sum(discount_cents), 0)::bigint       as discount_cents,
      coalesce(sum(subtotal_cents - discount_cents), 0)::bigint as net_sales_cents
    from paid
  ),
  g as (
    select s.*, rf.refunds_cents, cg.cogs_cents, cg.uncosted_lines,
           (s.net_sales_cents - rf.refunds_cents) as base_cents,
           (s.net_sales_cents - rf.refunds_cents - cg.cogs_cents) as gross_cents,
           public.has_permission(_tenant, 'profit.view') as ok
    from s, rf, cg
  )
  select
    g.revenue_cents, g.orders, g.tax_cents, g.service_cents, g.discount_cents,
    case when g.ok then g.net_sales_cents end,
    case when g.ok then g.refunds_cents end,
    case when g.ok then g.cogs_cents end,
    case when g.ok then g.gross_cents end,
    case when g.ok and g.base_cents > 0 then round(g.gross_cents::numeric / g.base_cents * 100, 1) end,
    case when g.ok then g.uncosted_lines end
  from g;
$$;

revoke execute on function public.report_sales(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_sales(uuid, timestamptz, timestamptz) to authenticated;

-- Top items: same signature. profit uses the line's share of the bill discount.
create or replace function public.report_top_items(
  _tenant uuid,
  _from   timestamptz,
  _to     timestamptz,
  _limit  integer default 10,
  _offset integer default 0
)
returns table (description text, qty bigint, revenue_cents bigint, cost_cents bigint, profit_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with g as (
    select bi.description,
           sum(bi.qty)::bigint as qty,
           sum(bi.total_cents)::bigint as revenue_cents,
           sum(bi.total_cents
               - case when b.subtotal_cents > 0
                      then round(b.discount_cents::numeric * bi.total_cents / b.subtotal_cents)
                      else 0 end)::bigint as net_cents,
           case when public.has_permission(_tenant, 'profit.view')
                 and bool_and(oi.unit_cost_cents is not null)
                then sum(bi.qty::bigint * oi.unit_cost_cents)::bigint end as cost_cents
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_item_costs oi on oi.order_item_id = bi.order_item_id
    where b.tenant_id = _tenant and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
      and public.has_permission(_tenant, 'reports.view')
    group by bi.description
  )
  select g.description, g.qty, g.revenue_cents, g.cost_cents, g.net_cents - g.cost_cents
  from g
  order by g.revenue_cents desc
  limit greatest(1, least(100, _limit))
  offset greatest(0, _offset);
$$;

-- daily_report_core: refunds deducted, discount allocated on top items. Same signature.
create or replace function public.daily_report_core(
  _tenant uuid,
  _day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tz text;
  _cur text;
  _cut integer;
  _from timestamptz;
  _to timestamptz;
  _out jsonb;
begin
  select coalesce(s.timezone, 'UTC'),
         coalesce(s.currency, 'USD'),
         coalesce(s.day_cutoff_minutes, 0)
    into _tz, _cur, _cut
  from public.tenant_settings s
  where s.tenant_id = _tenant;

  _tz  := coalesce(_tz, 'UTC');
  _cur := coalesce(_cur, 'USD');
  _cut := coalesce(_cut, 0);

  _day  := coalesce(_day, public.business_day(now(), _tz, _cut));
  _from := ((_day::timestamp + make_interval(mins => _cut)) at time zone _tz);
  _to   := _from + interval '1 day';

  with paid as (
    select b.subtotal_cents, b.tax_cents, b.service_charge_cents, b.discount_cents,
           b.tip_cents, b.rounding_cents, b.total_cents, b.table_id
    from public.bills b
    where b.tenant_id = _tenant
      and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
  ),
  sales as (
    select
      coalesce(sum(total_cents), 0)::bigint            as revenue_cents,
      coalesce(sum(subtotal_cents), 0)::bigint         as subtotal_cents,
      coalesce(sum(tax_cents), 0)::bigint              as tax_cents,
      coalesce(sum(service_charge_cents), 0)::bigint   as service_cents,
      coalesce(sum(discount_cents), 0)::bigint         as discount_cents,
      coalesce(sum(tip_cents), 0)::bigint              as tip_cents,
      coalesce(sum(rounding_cents), 0)::bigint         as rounding_cents,
      count(*)::bigint                                  as bills,
      count(distinct table_id)::bigint                  as tables_served
    from paid
  ),
  pays as (
    select p.method::text as method,
           coalesce(sum(p.amount_cents), 0)::bigint as amount_cents,
           count(*)::bigint as count
    from public.payments p
    where p.tenant_id = _tenant
      and p.status = 'completed'
      and p.created_at >= _from and p.created_at < _to
    group by p.method::text
  ),
  -- Cost of goods on the same paid bills. net item sales = subtotal − discount;
  -- tax, service and tip are not margin. A line whose snapshot is null is
  -- "uncosted": counted, never priced at zero.
  cogs as (
    select coalesce(sum(bi.qty::bigint * oi.unit_cost_cents), 0)::bigint as cogs_cents,
           count(*) filter (where oi.unit_cost_cents is null)::bigint as uncosted_lines
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_item_costs oi on oi.order_item_id = bi.order_item_id
    where b.tenant_id = _tenant and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
  ),
  refs as (
    select
      coalesce(sum(r.amount_cents), 0)::bigint as total_cents,
      -- close_cash_session treats a null method as NOT cash; the drawer only
      -- answers for what actually left it.
      coalesce(sum(r.amount_cents) filter (where r.method::text = 'cash'), 0)::bigint as cash_cents,
      count(*)::bigint as count
    from public.refunds r
    where r.tenant_id = _tenant
      and r.created_at >= _from and r.created_at < _to
  ),
  -- Two different failures, both wanted. The audit count is what report_extras
  -- reports, so the Sales tab and this sheet agree on "voids"; the line figures
  -- say what that was worth.
  void_lines as (
    select coalesce(sum(oi.unit_price_cents * oi.qty), 0)::bigint as value_cents,
           count(*)::bigint as lines
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.tenant_id = _tenant
      and oi.is_void
      and o.created_at >= _from and o.created_at < _to
  ),
  cancels as (
    select count(*)::bigint as count,
           coalesce(sum(v.value_cents), 0)::bigint as value_cents
    from public.orders o
    cross join lateral (
      select coalesce(sum(oi.unit_price_cents * oi.qty), 0)::bigint as value_cents
      from public.order_items oi
      where oi.order_id = o.id and not oi.is_void
    ) v
    where o.tenant_id = _tenant
      and o.status = 'cancelled'
      and o.created_at >= _from and o.created_at < _to
  ),
  sess as (
    select cs.id, cs.cashier_id, cs.opening_float_cents, cs.expected_cents,
           cs.counted_cents, cs.variance_cents, cs.opened_at, cs.closed_at,
           coalesce(mv.payouts, 0)::bigint  as payouts_cents,
           coalesce(mv.paid_in, 0)::bigint  as paid_in_cents,
           coalesce(mv.auto, 0)::bigint     as auto_approved_count,
           coalesce(pr.full_name, case when pr.username is not null then '@' || pr.username end)
             as cashier
    from public.cash_sessions cs
    left join lateral (
      select
        sum(m.amount_cents) filter (where m.kind = 'payout')      as payouts,
        sum(m.amount_cents) filter (where m.kind <> 'payout')     as paid_in,
        count(*) filter (where m.auto_approved)                    as auto
      from public.cash_movements m
      where m.session_id = cs.id and m.status = 'approved'
    ) mv on true
    left join public.profiles pr on pr.id = cs.cashier_id
    where cs.tenant_id = _tenant
      and cs.status = 'closed'
      and cs.closed_at >= _from and cs.closed_at < _to
  ),
  -- A Z-report printed with a drawer still open has to say so, or it reads as
  -- a full day when it is half of one.
  open_sess as (
    select count(*)::bigint as n
    from public.cash_sessions cs
    where cs.tenant_id = _tenant
      and cs.status = 'open'
      and cs.opened_at >= _from and cs.opened_at < _to
  ),
  top as (
    select bi.description, sum(bi.qty)::bigint as qty, sum(bi.total_cents)::bigint as revenue_cents,
           sum(bi.total_cents
               - case when b.subtotal_cents > 0
                      then round(b.discount_cents::numeric * bi.total_cents / b.subtotal_cents)
                      else 0 end)::bigint as net_cents,
           case when bool_and(oi.unit_cost_cents is not null)
                then sum(bi.qty::bigint * oi.unit_cost_cents)::bigint end as cost_cents
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_item_costs oi on oi.order_item_id = bi.order_item_id
    where b.tenant_id = _tenant and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
    group by bi.description
    order by 3 desc
    limit 10
  )
  select jsonb_build_object(
    'day', _day,
    'day_label', to_char(_day, 'FMDay, FMMon FMDD, YYYY'),
    'from', _from,
    'to', _to,
    'currency', _cur,
    'timezone', _tz,
    'cutoff_minutes', _cut,
    'sales', jsonb_build_object(
      'revenue_cents', s.revenue_cents,
      'subtotal_cents', s.subtotal_cents,
      'tax_cents', s.tax_cents,
      'service_cents', s.service_cents,
      'discount_cents', s.discount_cents,
      'tip_cents', s.tip_cents,
      'rounding_cents', s.rounding_cents,
      'bills', s.bills,
      'tables_served', s.tables_served,
      'avg_cents', case when s.bills > 0 then (s.revenue_cents / s.bills)::bigint else 0 end,
      'net_sales_cents', (s.subtotal_cents - s.discount_cents)::bigint,
      'cogs_cents', cg.cogs_cents,
      'refunds_cents', r.total_cents,
      'gross_profit_cents', (s.subtotal_cents - s.discount_cents - r.total_cents - cg.cogs_cents)::bigint,
      'margin_pct', case when (s.subtotal_cents - s.discount_cents - r.total_cents) > 0
                         then round((s.subtotal_cents - s.discount_cents - r.total_cents - cg.cogs_cents)::numeric
                                    / (s.subtotal_cents - s.discount_cents - r.total_cents) * 100, 1)
                         else null end,
      'uncosted_lines', cg.uncosted_lines
    ),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', p.method, 'amount_cents', p.amount_cents, 'count', p.count)
                       order by p.amount_cents desc)
      from pays p
    ), '[]'::jsonb),
    'payments_total_cents', coalesce((select sum(p.amount_cents) from pays p), 0)::bigint,
    -- Positive ⇒ money taken today against bills raised on an earlier day.
    -- Negative ⇒ bills raised today that nobody has settled yet.
    'carried_cents', (coalesce((select sum(p.amount_cents) from pays p), 0) - s.revenue_cents)::bigint,
    'refunds', jsonb_build_object(
      'total_cents', r.total_cents, 'cash_cents', r.cash_cents, 'count', r.count
    ),
    'voids', jsonb_build_object(
      'count', (select count(*) from public.audit_logs a
                where a.tenant_id = _tenant and a.action = 'void'
                  and a.created_at >= _from and a.created_at < _to)::bigint,
      'lines', vl.lines,
      'value_cents', vl.value_cents
    ),
    'cancellations', jsonb_build_object('count', c.count, 'value_cents', c.value_cents),
    'void_bills', (select count(*) from public.bills b
                   where b.tenant_id = _tenant and b.status = 'void'
                     and b.created_at >= _from and b.created_at < _to)::bigint,
    'cash', jsonb_build_object(
      'open_count', o.n,
      'sessions', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.closed_at) from sess x
      ), '[]'::jsonb),
      'totals', jsonb_build_object(
        'float_cents',    coalesce((select sum(x.opening_float_cents) from sess x), 0)::bigint,
        'payouts_cents',  coalesce((select sum(x.payouts_cents) from sess x), 0)::bigint,
        'paid_in_cents',  coalesce((select sum(x.paid_in_cents) from sess x), 0)::bigint,
        'expected_cents', coalesce((select sum(x.expected_cents) from sess x), 0)::bigint,
        'counted_cents',  coalesce((select sum(x.counted_cents) from sess x), 0)::bigint,
        'variance_cents', coalesce((select sum(x.variance_cents) from sess x), 0)::bigint,
        'sessions',       (select count(*) from sess)::bigint
      )
    ),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object('description', t.description, 'qty', t.qty,
                                          'revenue_cents', t.revenue_cents,
                                          'cost_cents', t.cost_cents,
                                          'profit_cents', t.net_cents - t.cost_cents)
                       order by t.revenue_cents desc)
      from top t
    ), '[]'::jsonb)
  )
  into _out
  from sales s, refs r, void_lines vl, cancels c, open_sess o, cogs cg;

  return _out;
end;
$$;

-- daily_report_strip_profit must also drop the new sales key.
create or replace function public.daily_report_strip_profit(_r jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when _r is null then null else
    jsonb_set(
      jsonb_set(_r, '{sales}',
        coalesce(_r->'sales', '{}'::jsonb)
          - 'net_sales_cents' - 'refunds_cents' - 'cogs_cents' - 'gross_profit_cents' - 'margin_pct' - 'uncosted_lines'),
      '{top_items}',
      coalesce((select jsonb_agg(e - 'cost_cents' - 'profit_cents')
                from jsonb_array_elements(coalesce(_r->'top_items', '[]'::jsonb)) e), '[]'::jsonb))
  end;
$$;
revoke execute on function public.daily_report_strip_profit(jsonb)
  from public, anon, authenticated;
