-- ============================================================================
-- Extended reporting: inventory, staff, customers, sales breakdowns, extras.
-- RLS-scoped SECURITY INVOKER (report_staff is DEFINER to read auth.users +
-- guards owner/manager). All windowed by [_from, _to).
-- ============================================================================

-- Inventory: consumption, wastage, COGS, valuation, reorder needs (per item).
create or replace function public.report_inventory(_tenant uuid, _from timestamptz, _to timestamptz)
returns table (item_id uuid, name text, uom text, current_qty numeric, reorder_level numeric,
               par_level numeric, cost_cents integer, consumed numeric, wasted numeric,
               cogs_cents bigint, valuation_cents bigint, reorder_qty numeric)
language sql stable security invoker set search_path = public
as $$
  select i.id, i.name, i.uom, i.current_qty, i.reorder_level, i.par_level, i.cost_cents,
         coalesce(-sum(m.qty) filter (where m.type = 'sale'), 0) as consumed,
         coalesce(-sum(m.qty) filter (where m.type = 'wastage'), 0) as wasted,
         round(coalesce(-sum(m.qty) filter (where m.type = 'sale'), 0) * i.cost_cents)::bigint as cogs_cents,
         round(i.current_qty * i.cost_cents)::bigint as valuation_cents,
         greatest(0, coalesce(nullif(i.par_level, 0), i.reorder_level) - i.current_qty) as reorder_qty
  from public.inventory_items i
  left join public.stock_movements m
    on m.inventory_item_id = i.id and m.created_at >= _from and m.created_at < _to
  where i.tenant_id = _tenant
  group by i.id
  order by 8 desc;
$$;
grant execute on function public.report_inventory(uuid, timestamptz, timestamptz) to authenticated;

-- Staff: sales/orders per waiter + shift minutes + tips.
create or replace function public.report_staff(_tenant uuid, _from timestamptz, _to timestamptz)
returns table (user_id uuid, email text, orders bigint, revenue_cents bigint, tips_cents bigint, shift_minutes bigint)
language sql stable security definer set search_path = public
as $$
  with sales as (
    select o.waiter_id uid, count(distinct b.id) orders, coalesce(sum(b.total_cents), 0) revenue
    from public.bills b join public.orders o on o.bill_id = b.id
    where b.tenant_id = _tenant and b.status = 'paid' and b.created_at >= _from and b.created_at < _to
      and o.waiter_id is not null
    group by o.waiter_id
  ),
  shifts as (
    select user_id uid, coalesce(sum(tips_cents), 0) tips,
           coalesce(sum(extract(epoch from (coalesce(clock_out, now()) - clock_in))) / 60, 0)::bigint minutes
    from public.staff_shifts
    where tenant_id = _tenant and clock_in >= _from and clock_in < _to
    group by user_id
  ),
  ids as (select uid from sales union select uid from shifts)
  select u.id, u.email::text, coalesce(s.orders, 0), coalesce(s.revenue, 0),
         coalesce(sh.tips, 0), coalesce(sh.minutes, 0)
  from ids x
  join auth.users u on u.id = x.uid
  left join sales s on s.uid = x.uid
  left join shifts sh on sh.uid = x.uid
  where public.has_tenant_role(_tenant, 'owner', 'manager') or public.is_platform_admin()
  order by coalesce(s.revenue, 0) desc;
$$;
grant execute on function public.report_staff(uuid, timestamptz, timestamptz) to authenticated;

-- Customers: orders + spend + points redeemed (per customer with activity).
create or replace function public.report_customers(_tenant uuid, _from timestamptz, _to timestamptz)
returns table (customer_id uuid, name text, orders bigint, spend_cents bigint, points_redeemed bigint)
language sql stable security invoker set search_path = public
as $$
  with ord as (
    select o.customer_id cid, count(distinct b.id) orders, coalesce(sum(b.total_cents), 0) spend
    from public.orders o join public.bills b on b.id = o.bill_id
    where o.tenant_id = _tenant and b.status = 'paid' and b.created_at >= _from and b.created_at < _to
      and o.customer_id is not null
    group by o.customer_id
  ),
  red as (
    select la.customer_id cid, coalesce(-sum(lt.points) filter (where lt.type = 'burn'), 0) redeemed
    from public.loyalty_transactions lt join public.loyalty_accounts la on la.id = lt.loyalty_account_id
    where lt.tenant_id = _tenant and lt.created_at >= _from and lt.created_at < _to
    group by la.customer_id
  )
  select c.id, c.name, coalesce(o.orders, 0), coalesce(o.spend, 0), coalesce(r.redeemed, 0)
  from public.customers c
  left join ord o on o.cid = c.id
  left join red r on r.cid = c.id
  where c.tenant_id = _tenant and (o.orders is not null or r.redeemed is not null)
  order by coalesce(o.spend, 0) desc;
$$;
grant execute on function public.report_customers(uuid, timestamptz, timestamptz) to authenticated;

-- Sales broken down by a bill-level dimension: 'order_type' | 'table' | 'hour'.
create or replace function public.report_sales_by_bill(_tenant uuid, _from timestamptz, _to timestamptz, _dim text, _tz text default 'UTC')
returns table (label text, orders bigint, revenue_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select
    case _dim
      when 'order_type' then o.order_type::text
      when 'table' then coalesce(rt.label, 'Takeaway')
      when 'hour' then lpad(extract(hour from (b.created_at at time zone _tz))::text, 2, '0') || ':00'
      else 'all'
    end as label,
    count(*)::bigint, sum(b.total_cents)::bigint
  from public.bills b
  join public.orders o on o.bill_id = b.id
  left join public.restaurant_tables rt on rt.id = b.table_id
  where b.tenant_id = _tenant and b.status = 'paid' and b.created_at >= _from and b.created_at < _to
  group by 1
  order by 3 desc;
$$;
grant execute on function public.report_sales_by_bill(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- Sales by menu category (line-level revenue).
create or replace function public.report_sales_by_category(_tenant uuid, _from timestamptz, _to timestamptz)
returns table (label text, orders bigint, revenue_cents bigint)
language sql stable security invoker set search_path = public
as $$
  select coalesce(mc.name, 'Uncategorized'), count(distinct b.id)::bigint, coalesce(sum(bi.total_cents), 0)::bigint
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  left join public.order_items oi on oi.id = bi.order_item_id
  left join public.menu_items mi on mi.id = oi.item_id
  left join public.menu_categories mc on mc.id = mi.category_id
  where b.tenant_id = _tenant and b.status = 'paid' and b.created_at >= _from and b.created_at < _to
  group by 1
  order by 3 desc;
$$;
grant execute on function public.report_sales_by_category(uuid, timestamptz, timestamptz) to authenticated;

-- Extras for the sales dashboard: voids, refunds, tables served, paid orders.
create or replace function public.report_extras(_tenant uuid, _from timestamptz, _to timestamptz)
returns table (voids bigint, refunds_cents bigint, tables_served bigint, paid_orders bigint)
language sql stable security invoker set search_path = public
as $$
  select
    (select count(*) from public.audit_logs a where a.tenant_id = _tenant and a.action = 'void' and a.created_at >= _from and a.created_at < _to)::bigint,
    (select coalesce(sum(amount_cents), 0) from public.refunds r where r.tenant_id = _tenant and r.created_at >= _from and r.created_at < _to)::bigint,
    (select count(distinct b.table_id) from public.bills b where b.tenant_id = _tenant and b.status = 'paid' and b.table_id is not null and b.created_at >= _from and b.created_at < _to)::bigint,
    (select count(*) from public.bills b where b.tenant_id = _tenant and b.status = 'paid' and b.created_at >= _from and b.created_at < _to)::bigint;
$$;
grant execute on function public.report_extras(uuid, timestamptz, timestamptz) to authenticated;
