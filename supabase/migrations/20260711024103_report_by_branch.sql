-- Multi-branch sales rollup (per-branch revenue + orders). RLS-scoped INVOKER.
create or replace function public.report_by_branch(
  _tenant uuid, _from timestamptz, _to timestamptz
)
returns table (branch_id uuid, branch_name text, revenue_cents bigint, orders bigint)
language sql stable security invoker set search_path = public
as $$
  select b.branch_id, coalesce(br.name, 'Unassigned'),
         sum(b.total_cents)::bigint, count(*)::bigint
  from public.bills b
  left join public.branches br on br.id = b.branch_id
  where b.tenant_id = _tenant and b.status = 'paid'
    and b.created_at >= _from and b.created_at < _to
  group by b.branch_id, br.name
  order by 3 desc;
$$;
grant execute on function public.report_by_branch(uuid, timestamptz, timestamptz) to authenticated;
