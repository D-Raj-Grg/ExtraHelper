-- ============================================================================
-- Reporting detail aggregations (server-side, RLS-scoped SECURITY INVOKER).
-- report_top_items: best-selling bill lines in a window.
-- report_payments: paid amounts by method in a window.
-- ============================================================================

create or replace function public.report_top_items(
  _tenant uuid, _from timestamptz, _to timestamptz
)
returns table (description text, qty bigint, revenue_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select bi.description, sum(bi.qty)::bigint, sum(bi.total_cents)::bigint
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  where b.tenant_id = _tenant and b.status = 'paid'
    and b.created_at >= _from and b.created_at < _to
  group by bi.description
  order by 3 desc
  limit 10;
$$;

create or replace function public.report_payments(
  _tenant uuid, _from timestamptz, _to timestamptz
)
returns table (method text, amount_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select p.method::text, sum(p.amount_cents)::bigint
  from public.payments p
  join public.bills b on b.id = p.bill_id
  where p.tenant_id = _tenant and p.status = 'completed'
    and p.created_at >= _from and p.created_at < _to
  group by p.method
  order by 2 desc;
$$;

grant execute on function public.report_top_items(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_payments(uuid, timestamptz, timestamptz) to authenticated;
