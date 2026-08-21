-- ============================================================================
-- daily_report — one business day, everything a manager needs to close the till.
--
-- Shaped like dashboard_summary: a single jsonb payload from one round trip,
-- carrying currency and timezone so every client renders identical figures and
-- Flutter can pick this up later without a second implementation (rule 1).
--
-- THE FAN-OUT: every money aggregate reads `bills` alone. add_order_to_bill
-- merges tables, so `bills join orders` multiplies a bill's total by its order
-- count — the same trap report_sales_by_bill dodges with `distinct on (b.id)`.
-- The only orders join here is the cancellations CTE, which counts orders on
-- purpose and prices them from their own non-void lines.
--
-- THE RECONCILIATION: revenue buckets on bills.created_at, payments on
-- payments.created_at (matching report_sales and report_payments respectively).
-- Cash taken today against a bill raised yesterday lands in one and not the
-- other, so the two legitimately disagree. Rather than hide it, the payload
-- returns both plus `carried_cents`, and the sheet prints a line saying so.
-- ============================================================================

create or replace function public.daily_report(
  _tenant uuid,
  _day date default null
)
returns jsonb
language plpgsql
stable
security invoker
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
  -- Same contract as dashboard_summary: no permission is an empty answer, not
  -- an error, so the page can render a friendly gate instead of a 500.
  if not public.has_permission(_tenant, 'reports.view') then
    return null;
  end if;

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
    select bi.description, sum(bi.qty)::bigint as qty, sum(bi.total_cents)::bigint as revenue_cents
    from public.bill_items bi
    join public.bills b on b.id = bi.bill_id
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
      'avg_cents', case when s.bills > 0 then (s.revenue_cents / s.bills)::bigint else 0 end
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
                                          'revenue_cents', t.revenue_cents)
                       order by t.revenue_cents desc)
      from top t
    ), '[]'::jsonb)
  )
  into _out
  from sales s, refs r, void_lines vl, cancels c, open_sess o;

  return _out;
end;
$$;

revoke execute on function public.daily_report(uuid, date) from public, anon;
grant execute on function public.daily_report(uuid, date) to authenticated;

-- ============================================================================
-- report_sales_by_day — the spine of a date range: one row per business day.
--
-- `orders` here means paid bills, consistent with report_sales.orders, and for
-- the same reason: joining orders would fan a merged bill out across its tables.
-- Zero-filled so a quiet Tuesday shows as zero rather than vanishing, and capped
-- at 366 rows so the "All time" window can't return a decade.
--
-- day_label is rendered here on purpose: `new Date("2026-08-20")` in a browser
-- parses as UTC midnight and shifts the date backwards west of Greenwich.
-- ============================================================================

create or replace function public.report_sales_by_day(
  _tenant uuid,
  _from timestamptz,
  _to timestamptz
)
returns table (day date, day_label text, orders bigint, revenue_cents bigint, avg_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select coalesce(s.timezone, 'UTC') as tz, coalesce(s.day_cutoff_minutes, 0) as cut
    from public.tenant_settings s
    where s.tenant_id = _tenant
  ),
  by_day as (
    select public.business_day(b.created_at, c.tz, c.cut) as d,
           count(*)::bigint as orders,
           sum(b.total_cents)::bigint as revenue_cents
    from public.bills b, cfg c
    where b.tenant_id = _tenant
      and b.status = 'paid'
      and b.created_at >= _from and b.created_at < _to
    group by 1
  ),
  series as (
    select gs::date as d
    from cfg c,
         generate_series(
           public.business_day(_from, c.tz, c.cut),
           public.business_day(_to - interval '1 microsecond', c.tz, c.cut),
           interval '1 day'
         ) gs
  )
  select s.d,
         to_char(s.d, 'FMDy, FMMon FMDD'),
         coalesce(b.orders, 0)::bigint,
         coalesce(b.revenue_cents, 0)::bigint,
         case when coalesce(b.orders, 0) > 0
              then (b.revenue_cents / b.orders)::bigint else 0 end
  from series s
  left join by_day b on b.d = s.d
  where public.has_permission(_tenant, 'reports.view')
  order by s.d desc
  limit 366;
$$;

revoke execute on function public.report_sales_by_day(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_sales_by_day(uuid, timestamptz, timestamptz) to authenticated;
