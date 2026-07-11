-- ============================================================================
-- Reporting aggregation (server-side, rule: aggregate in SQL not the client).
-- report_sales sums PAID bills in a time window. SECURITY INVOKER — RLS on
-- `bills` scopes it to the caller's tenant, so passing another tenant's id
-- returns nothing. Call twice (current + previous range) for period comparison.
-- ============================================================================

create or replace function public.report_sales(
  _tenant uuid,
  _from   timestamptz,
  _to     timestamptz
)
returns table (
  revenue_cents  bigint,
  orders         bigint,
  tax_cents      bigint,
  service_cents  bigint,
  discount_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(total_cents), 0)::bigint,
    count(*)::bigint,
    coalesce(sum(tax_cents), 0)::bigint,
    coalesce(sum(service_charge_cents), 0)::bigint,
    coalesce(sum(discount_cents), 0)::bigint
  from public.bills
  where tenant_id = _tenant
    and status = 'paid'
    and created_at >= _from
    and created_at < _to;
$$;

grant execute on function public.report_sales(uuid, timestamptz, timestamptz) to authenticated;
