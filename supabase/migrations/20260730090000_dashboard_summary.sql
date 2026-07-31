-- ============================================================================
-- dashboard_summary — the owner dashboard, computed once in SQL for both clients.
--
-- The web dashboard did this as six parallel PostgREST reads plus tz-aware day
-- bucketing in TypeScript (`Intl.DateTimeFormat` per bill). Flutter cannot copy
-- that: `package:intl` has no IANA timezone database, so the same bucketing in
-- Dart would need a new dependency AND a second implementation of a money
-- number — exactly the drift CLAUDE.md rule 1 forbids. Postgres already owns
-- `tenant_settings.timezone`, so the arithmetic lives here and both clients render.
--
-- SECURITY INVOKER: RLS on bills/orders/kots/inventory/reservations scopes every
-- read to the caller's tenant, so passing another tenant's id returns nothing.
-- Gated on `reports.view` the same way `report_extras` is — revenue is not a
-- waiter's business. Returns NULL (not an error) when the caller lacks the key,
-- so a surface can degrade instead of exploding.
-- ============================================================================

create or replace function public.dashboard_summary(_tenant uuid, _days int default 14)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  _tz    text;
  _cur   text;
  _today date;
  _from  timestamptz;
begin
  if not public.has_permission(_tenant, 'reports.view') then
    return null;
  end if;

  select coalesce(s.timezone, 'UTC'), coalesce(s.currency, 'USD')
    into _tz, _cur
  from public.tenant_settings s
  where s.tenant_id = _tenant;

  _tz  := coalesce(_tz, 'UTC');
  _cur := coalesce(_cur, 'USD');

  -- 1..90: a phone chart cannot read more, and it caps the scan.
  _days  := least(greatest(coalesce(_days, 14), 1), 90);
  _today := (now() at time zone _tz)::date;
  -- Local midnight of the first day in the window, back in UTC.
  _from  := ((_today - (_days - 1))::timestamp) at time zone _tz;

  return (
    with paid as (
      select
        ((b.created_at at time zone _tz)::date) as d,
        b.total_cents
      from public.bills b
      where b.tenant_id = _tenant
        and b.status = 'paid'
        and b.created_at >= _from
    ),
    by_day as (
      select d, sum(total_cents)::bigint as cents, count(*)::bigint as bills
      from paid group by d
    ),
    -- Zero-filled: a day with no sales is a real answer, and a gap in the
    -- series would draw as a straight line between the days either side.
    series as (
      select
        g::date as d,
        coalesce(bd.cents, 0)::bigint as cents
      from generate_series(_today - (_days - 1), _today, interval '1 day') g
      left join by_day bd on bd.d = g::date
      order by g
    ),
    low_stock as (
      select i.name, i.uom, i.current_qty, i.reorder_level
      from public.inventory_items i
      where i.tenant_id = _tenant
        and i.reorder_level > 0
        and i.current_qty < i.reorder_level
      order by (i.current_qty / nullif(i.reorder_level, 0))
      limit 6
    ),
    upcoming as (
      select
        coalesce(c.name, 'Guest') as name,
        r.party_size,
        t.label as table_label,
        r.status::text as status,
        r.reserved_at,
        to_char(r.reserved_at at time zone _tz, 'FMMon FMDD, YYYY, FMHH12:MI AM') as at_text
      from public.reservations r
      left join public.customers c on c.id = r.customer_id
      left join public.restaurant_tables t on t.id = r.table_id
      where r.tenant_id = _tenant
        and r.status in ('pending', 'confirmed', 'seated')
        and r.reserved_at >= now() - interval '2 hours'
      order by r.reserved_at
      limit 6
    ),
    recent as (
      select
        b.id,
        b.total_cents,
        t.label as table_label,
        b.created_at,
        to_char(b.created_at at time zone _tz, 'FMMon FMDD, YYYY, FMHH12:MI AM') as at_text
      from public.bills b
      left join public.restaurant_tables t on t.id = b.table_id
      where b.tenant_id = _tenant
        and b.status = 'paid'
      order by b.created_at desc
      limit 6
    )
    select jsonb_build_object(
      'currency', _cur,
      'timezone', _tz,
      'days',     _days,
      'today', jsonb_build_object(
        'revenue_cents', coalesce((select cents from by_day where d = _today), 0),
        'bills',         coalesce((select bills from by_day where d = _today), 0),
        'avg_cents',     coalesce(
          (select round(cents::numeric / nullif(bills, 0))::bigint from by_day where d = _today), 0)
      ),
      'yesterday_revenue_cents',
        coalesce((select cents from by_day where d = _today - 1), 0),
      'active_orders', (
        select count(*)::bigint from public.orders o
        where o.tenant_id = _tenant
          and o.status in ('draft', 'placed', 'in_kitchen', 'preparing', 'ready', 'served')
      ),
      'open_kots', (
        select count(*)::bigint from public.kots k
        where k.tenant_id = _tenant
          and k.status in ('new', 'preparing', 'ready')
      ),
      'low_stock_count', (
        select count(*)::bigint from public.inventory_items i
        where i.tenant_id = _tenant
          and i.reorder_level > 0
          and i.current_qty < i.reorder_level
      ),
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day',           to_char(d, 'YYYY-MM-DD'),
          'label',         to_char(d, 'FMMon FMDD'),
          'revenue_cents', cents
        )) from series), '[]'::jsonb),
      'low_stock', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',          name,
          'uom',           uom,
          'current_qty',   current_qty,
          'reorder_level', reorder_level
        )) from low_stock), '[]'::jsonb),
      'reservations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name',        name,
          'party_size',  party_size,
          'table_label', table_label,
          'status',      status,
          'at',          reserved_at,
          'at_text',     at_text
        )) from upcoming), '[]'::jsonb),
      'recent_payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bill_id',     id,
          'table_label', table_label,
          'total_cents', total_cents,
          'at',          created_at,
          'at_text',     at_text
        )) from recent), '[]'::jsonb)
    )
  );
end;
$$;

-- `public` holds EXECUTE by default; revoking from anon alone does nothing.
revoke execute on function public.dashboard_summary(uuid, int) from public, anon;
grant  execute on function public.dashboard_summary(uuid, int) to authenticated;
