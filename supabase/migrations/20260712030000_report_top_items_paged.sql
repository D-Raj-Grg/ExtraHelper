-- Add pagination (limit/offset) to report_top_items. Drop the 3-arg version and
-- recreate with defaulted paging args so existing 3-named-arg callers still work
-- (no ambiguity). Returns one extra page-worth (+1) is handled client-side.
drop function if exists public.report_top_items(uuid, timestamptz, timestamptz);

create or replace function public.report_top_items(
  _tenant uuid, _from timestamptz, _to timestamptz,
  _limit int default 10, _offset int default 0
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
  limit greatest(1, least(100, _limit))
  offset greatest(0, _offset);
$$;

grant execute on function public.report_top_items(uuid, timestamptz, timestamptz, int, int) to authenticated;
