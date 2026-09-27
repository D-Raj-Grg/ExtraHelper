-- Customer credit visibility.
--
-- leave_bill_on_credit forces a guest onto the bill but nothing ever showed
-- what that guest owes. There is no ledger: the debt is the bill itself, left
-- on open/partial, minus whatever payments completed against it. These two
-- read-only functions surface that.
--
-- Both are security invoker (RLS applies) and additionally gate on the
-- permission the calling screen already needs, so a cashier without loyalty
-- access still gets the checkout "owes" line but not the CRM roll-up.

create or replace function public.customer_credit_summary(_tenant uuid)
returns table (customer_id uuid, outstanding_cents bigint, unpaid_bills bigint, oldest_unpaid timestamptz)
language sql stable security invoker set search_path = public
as $$
  with bc as (
    -- one guest per bill: the first non-cancelled order carrying a customer
    select distinct on (b.id) b.id bill_id, o.customer_id cid, b.total_cents total, b.created_at
    from public.bills b
    join public.orders o on o.bill_id = b.id and o.status <> 'cancelled' and o.customer_id is not null
    where b.tenant_id = _tenant and b.status in ('open', 'partial')
    order by b.id, o.created_at
  ),
  paid as (
    select p.bill_id, coalesce(sum(p.amount_cents), 0) paid
    from public.payments p join bc on bc.bill_id = p.bill_id
    where p.status = 'completed'
    group by p.bill_id
  )
  select bc.cid,
         sum(greatest(bc.total - coalesce(paid.paid, 0), 0))::bigint,
         count(*)::bigint,
         min(bc.created_at)
  from bc left join paid on paid.bill_id = bc.bill_id
  where public.has_permission(_tenant, 'checkout.view') or public.has_permission(_tenant, 'loyalty.view')
  group by bc.cid;
$$;

create or replace function public.customer_bill_history(_tenant uuid, _customer uuid, _limit int default 50)
returns table (
  bill_id uuid,
  created_at timestamptz,
  status public.bill_status,
  total_cents bigint,
  paid_cents bigint,
  outstanding_cents bigint,
  table_label text,
  items_summary text
)
language sql stable security invoker set search_path = public
as $$
  with bc as (
    select distinct on (b.id) b.id, b.created_at, b.status, b.total_cents::bigint total, b.table_id
    from public.bills b
    join public.orders o on o.bill_id = b.id and o.status <> 'cancelled'
    where b.tenant_id = _tenant and o.customer_id = _customer and b.status <> 'void'
    order by b.id, o.created_at
  ),
  paid as (
    select p.bill_id, coalesce(sum(p.amount_cents), 0)::bigint paid
    from public.payments p join bc on bc.id = p.bill_id
    where p.status = 'completed'
    group by p.bill_id
  ),
  items as (
    select bi.bill_id,
           string_agg(bi.description, ', ' order by bi.total_cents desc) filter (where bi.rn <= 3)
             || case when max(bi.rn) > 3 then ' +' || (max(bi.rn) - 3)::text || ' more' else '' end summary
    from (
      select bi.bill_id, bi.description, bi.total_cents,
             row_number() over (partition by bi.bill_id order by bi.total_cents desc) rn
      from public.bill_items bi join bc on bc.id = bi.bill_id
    ) bi
    group by bi.bill_id
  )
  select bc.id, bc.created_at, bc.status, bc.total,
         coalesce(paid.paid, 0),
         case when bc.status in ('open', 'partial') then greatest(bc.total - coalesce(paid.paid, 0), 0) else 0 end,
         t.label,
         items.summary
  from bc
  left join paid on paid.bill_id = bc.id
  left join items on items.bill_id = bc.id
  left join public.restaurant_tables t on t.id = bc.table_id
  where public.has_permission(_tenant, 'loyalty.view')
  order by bc.created_at desc
  limit greatest(1, least(200, _limit));
$$;

revoke execute on function public.customer_credit_summary(uuid) from public, anon;
grant execute on function public.customer_credit_summary(uuid) to authenticated;
revoke execute on function public.customer_bill_history(uuid, uuid, int) from public, anon;
grant execute on function public.customer_bill_history(uuid, uuid, int) to authenticated;
