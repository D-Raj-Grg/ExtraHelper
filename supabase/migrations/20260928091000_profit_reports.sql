-- ============================================================================
-- Dish cost price → gross profit. Part 2: reports.
--
-- Every figure here is derived from order_items.unit_cost_cents, the snapshot
-- taken in 20260928090000_dish_cost_schema.sql. One definition, used
-- everywhere:
--   net_sales      Σ (bills.subtotal − bills.discount) over paid bills
--   cogs           Σ bill_items.qty × order_items.unit_cost_cents
--   gross_profit   net_sales − cogs
--   margin_pct     gross_profit / net_sales × 100, one decimal
--   uncosted_lines bill lines whose snapshot is null (shown, never zeroed)
-- Tax, service charge and tip are pass-through, not margin.
--
-- Visibility follows profit.view, degrading rather than erroring: a caller
-- with reports.view but not profit.view gets the same rows with the profit
-- columns null (report_sales / report_top_items) or the keys removed
-- (daily_report). The printed Z-report never carries profit — the print queue
-- is drained by whichever member has the app open (see 20260821093000).
--
-- report_sales and report_top_items change their return type, so they are
-- dropped and recreated and their grants re-issued by full signature.
--
-- Not in v1: add-on (modifier) costs; dashboard_summary.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- report_sales: headline tiles for the Sales tab.
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
    select coalesce(sum(bi.qty * oi.unit_cost_cents), 0)::bigint as cogs_cents,
           count(*) filter (where oi.unit_cost_cents is null)::bigint as uncosted_lines
    from public.bill_items bi
    join paid p on p.id = bi.bill_id
    left join public.order_items oi on oi.id = bi.order_item_id
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
  )
  select
    s.revenue_cents, s.orders, s.tax_cents, s.service_cents, s.discount_cents,
    case when public.has_permission(_tenant, 'profit.view') then s.net_sales_cents end,
    case when public.has_permission(_tenant, 'profit.view') then cg.cogs_cents end,
    case when public.has_permission(_tenant, 'profit.view') then s.net_sales_cents - cg.cogs_cents end,
    case when public.has_permission(_tenant, 'profit.view') and s.net_sales_cents > 0
         then round((s.net_sales_cents - cg.cogs_cents)::numeric / s.net_sales_cents * 100, 1) end,
    case when public.has_permission(_tenant, 'profit.view') then cg.uncosted_lines end
  from s, cg;
$$;

revoke execute on function public.report_sales(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_sales(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- report_top_items: still keyed by description (what both clients render and
-- what the CSV exports). cost is null for a group with any uncosted line —
-- a partial cost would read as a better margin than the dish really has.
-- ---------------------------------------------------------------------------
drop function if exists public.report_top_items(uuid, timestamptz, timestamptz, integer, integer);

create function public.report_top_items(
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
           case when public.has_permission(_tenant, 'profit.view')
                 and bool_and(oi.unit_cost_cents is not null)
                then sum(bi.qty * oi.unit_cost_cents)::bigint end as cost_cents
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_items oi on oi.id = bi.order_item_id
    where b.tenant_id = _tenant and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
      and public.has_permission(_tenant, 'reports.view')
    group by bi.description
  )
  select g.description, g.qty, g.revenue_cents, g.cost_cents, g.revenue_cents - g.cost_cents
  from g
  order by g.revenue_cents desc
  limit greatest(1, least(100, _limit))
  offset greatest(0, _offset);
$$;

revoke execute on function public.report_top_items(uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant  execute on function public.report_top_items(uuid, timestamptz, timestamptz, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- daily_report_core: the 20260821093000 aggregation (renamed in
-- 20260926090000) plus a cogs CTE. Same signature → create or replace; it
-- stays revoked from everyone, the wrappers below are its only callers.
-- ---------------------------------------------------------------------------
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
    select coalesce(sum(bi.qty * oi.unit_cost_cents), 0)::bigint as cogs_cents,
           count(*) filter (where oi.unit_cost_cents is null)::bigint as uncosted_lines
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_items oi on oi.id = bi.order_item_id
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
           case when bool_and(oi.unit_cost_cents is not null)
                then sum(bi.qty * oi.unit_cost_cents)::bigint end as cost_cents
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
    left join public.order_items oi on oi.id = bi.order_item_id
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
      'gross_profit_cents', (s.subtotal_cents - s.discount_cents - cg.cogs_cents)::bigint,
      'margin_pct', case when (s.subtotal_cents - s.discount_cents) > 0
                         then round((s.subtotal_cents - s.discount_cents - cg.cogs_cents)::numeric
                                    / (s.subtotal_cents - s.discount_cents) * 100, 1)
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
                                          'profit_cents', t.revenue_cents - t.cost_cents)
                       order by t.revenue_cents desc)
      from top t
    ), '[]'::jsonb)
  )
  into _out
  from sales s, refs r, void_lines vl, cancels c, open_sess o, cogs cg;

  return _out;
end;
$$;

revoke execute on function public.daily_report_core(uuid, date)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Strip the profit keys for callers who may not see them.
-- ---------------------------------------------------------------------------
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
          - 'net_sales_cents' - 'cogs_cents' - 'gross_profit_cents' - 'margin_pct' - 'uncosted_lines'),
      '{top_items}',
      coalesce((select jsonb_agg(e - 'cost_cents' - 'profit_cents')
                from jsonb_array_elements(coalesce(_r->'top_items', '[]'::jsonb)) e), '[]'::jsonb))
  end;
$$;

revoke execute on function public.daily_report_strip_profit(jsonb)
  from public, anon, authenticated;

-- What a person asks for: reports.view to see anything, profit.view to see
-- the cost side. Same signature and ACL as before.
create or replace function public.daily_report(
  _tenant uuid,
  _day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission(_tenant, 'reports.view') then
    return null;
  end if;
  if public.has_permission(_tenant, 'profit.view') then
    return public.daily_report_build(_tenant, _day);
  end if;
  return public.daily_report_strip_profit(public.daily_report_build(_tenant, _day));
end;
$$;

revoke execute on function public.daily_report(uuid, date) from public, anon;
grant execute on function public.daily_report(uuid, date) to authenticated;

-- The print path always strips: the drainer is any member of the restaurant.
create or replace function public.daily_report_for_print(_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _day date;
  _doc public.print_doc;
begin
  select j.tenant_id, j.business_day, j.doc
    into _tenant, _day, _doc
  from public.print_jobs j
  where j.id = _job_id;

  if _tenant is null then
    raise exception 'that print job no longer exists' using errcode = 'P0002';
  end if;
  if _doc <> 'day_report' then
    raise exception 'that job is not a day report' using errcode = '42501';
  end if;
  if _tenant not in (select public.current_tenant_ids()) then
    raise exception 'not a member of this restaurant' using errcode = '42501';
  end if;

  return public.daily_report_strip_profit(public.daily_report_build(_tenant, _day));
end;
$$;

revoke execute on function public.daily_report_for_print(uuid) from public, anon;
grant execute on function public.daily_report_for_print(uuid) to authenticated;
