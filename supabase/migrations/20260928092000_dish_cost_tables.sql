-- ============================================================================
-- Dish cost → gross profit. Part 3: costs move to their own tables.
--
-- Review of parts 1–2 found the permission gate was only as strong as the
-- RPC layer: cost_cents sat on menu_items / item_variants and unit_cost_cents
-- on order_items, all readable by every tenant member through the table API
-- (tenant-scoped RLS), and order_items.tenant_all let any member PATCH the
-- snapshot. "Owner only" has to hold at the data layer, so:
--
--   menu_item_costs     (item_id pk)        what a dish costs
--   item_variant_costs  (variant_id pk)     what a portion costs
--   order_item_costs    (order_item_id pk)  the snapshot per sold line
--
-- Each carries tenant_id and a SELECT policy of has_permission(tenant_id,
-- 'profit.view'). No INSERT/UPDATE/DELETE is granted to any API role: the
-- security-definer RPCs and the order_items trigger are the only writers.
-- A missing order_item_costs row means "uncosted"; nothing is ever stored as 0
-- for an unknown cost. The three columns from part 1 are copied across and
-- dropped.
--
-- Also from review: bi.qty × unit_cost_cents was integer × integer before
-- sum() — promote to bigint so a large-qty line cannot overflow and take the
-- Sales tab down with it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables + RLS
-- ---------------------------------------------------------------------------
create table if not exists public.menu_item_costs (
  item_id    uuid primary key references public.menu_items(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  cost_cents integer not null check (cost_cents >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists idx_menu_item_costs_tenant on public.menu_item_costs(tenant_id);

create table if not exists public.item_variant_costs (
  variant_id uuid primary key references public.item_variants(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  cost_cents integer not null check (cost_cents >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists idx_item_variant_costs_tenant on public.item_variant_costs(tenant_id);

create table if not exists public.order_item_costs (
  order_item_id   uuid primary key references public.order_items(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists idx_order_item_costs_tenant on public.order_item_costs(tenant_id);

alter table public.menu_item_costs    enable row level security;
alter table public.item_variant_costs enable row level security;
alter table public.order_item_costs   enable row level security;

drop policy if exists menu_item_costs_read on public.menu_item_costs;
create policy menu_item_costs_read on public.menu_item_costs for select to authenticated
  using (public.has_permission(tenant_id, 'profit.view'));
drop policy if exists item_variant_costs_read on public.item_variant_costs;
create policy item_variant_costs_read on public.item_variant_costs for select to authenticated
  using (public.has_permission(tenant_id, 'profit.view'));
drop policy if exists order_item_costs_read on public.order_item_costs;
create policy order_item_costs_read on public.order_item_costs for select to authenticated
  using (public.has_permission(tenant_id, 'profit.view'));

-- Read only, and only for the permitted. Writers are the definer functions.
revoke all on public.menu_item_costs, public.item_variant_costs, public.order_item_costs
  from public, anon, authenticated;
grant select on public.menu_item_costs, public.item_variant_costs, public.order_item_costs
  to authenticated;

-- ---------------------------------------------------------------------------
-- Carry part-1 data across, then drop the exposed columns.
-- ---------------------------------------------------------------------------
insert into public.menu_item_costs (item_id, tenant_id, cost_cents)
select id, tenant_id, cost_cents from public.menu_items where cost_cents is not null
on conflict (item_id) do nothing;

insert into public.item_variant_costs (variant_id, tenant_id, cost_cents)
select id, tenant_id, cost_cents from public.item_variants where cost_cents is not null
on conflict (variant_id) do nothing;

insert into public.order_item_costs (order_item_id, tenant_id, unit_cost_cents)
select id, tenant_id, unit_cost_cents from public.order_items where unit_cost_cents is not null
on conflict (order_item_id) do nothing;

drop trigger if exists trg_order_item_cost on public.order_items;

alter table public.menu_items    drop column if exists cost_cents;
alter table public.item_variants drop column if exists cost_cents;
alter table public.order_items   drop column if exists unit_cost_cents;

-- ---------------------------------------------------------------------------
-- Effective cost, now reading the cost tables. Still revoked from every role.
-- ---------------------------------------------------------------------------
create or replace function public.effective_item_cost_cents(_item_id uuid, _variant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select vc.cost_cents, coalesce(iv.recipe_scale, 1) as scale
    from public.item_variants iv
    left join public.item_variant_costs vc on vc.variant_id = iv.id
    where iv.id = _variant_id and iv.item_id = _item_id
  ),
  scale as (
    select coalesce((select scale from v), 1) as s
  ),
  recipe as (
    select round(sum(r.qty * ii.cost_cents))::integer as cents
    from public.recipes r
    join public.inventory_items ii on ii.id = r.inventory_item_id
    where r.menu_item_id = _item_id
    having count(r.id) > 0
  )
  select coalesce(
    (select cost_cents from v),
    (select round(mc.cost_cents * (select s from scale))::integer
       from public.menu_item_costs mc where mc.item_id = _item_id),
    (select round(cents * (select s from scale))::integer from recipe)
  )
  where _item_id is not null;
$$;

revoke execute on function public.effective_item_cost_cents(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot trigger: AFTER insert / item or variant change, upsert or remove
-- the cost row. Clients cannot write order_item_costs at all, so the old
-- "explicit value on insert" escape hatch goes away with the column.
-- ---------------------------------------------------------------------------
create or replace function public.trg_order_item_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _c integer;
begin
  if tg_op = 'UPDATE'
     and new.item_id is not distinct from old.item_id
     and new.variant_id is not distinct from old.variant_id then
    return null;
  end if;

  _c := case when new.item_id is null then null
             else public.effective_item_cost_cents(new.item_id, new.variant_id) end;

  if _c is null then
    delete from public.order_item_costs where order_item_id = new.id;
  else
    insert into public.order_item_costs (order_item_id, tenant_id, unit_cost_cents)
    values (new.id, new.tenant_id, _c)
    on conflict (order_item_id) do update
      set unit_cost_cents = excluded.unit_cost_cents, created_at = now();
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_order_item_cost()
  from public, anon, authenticated;

create trigger trg_order_item_cost
  after insert or update of item_id, variant_id on public.order_items
  for each row execute function public.trg_order_item_cost();

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
create or replace function public.set_item_cost(_item_id uuid, _cost_cents integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _old integer;
begin
  select tenant_id into _tenant from public.menu_items where id = _item_id;
  if _tenant is null then
    raise exception 'dish not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cost_cents is not null and (_cost_cents < 0 or _cost_cents > 100000000) then
    raise exception 'cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  select cost_cents into _old from public.menu_item_costs where item_id = _item_id;
  if _old is not distinct from _cost_cents then
    return;
  end if;

  if _cost_cents is null then
    delete from public.menu_item_costs where item_id = _item_id;
  else
    insert into public.menu_item_costs (item_id, tenant_id, cost_cents)
    values (_item_id, _tenant, _cost_cents)
    on conflict (item_id) do update set cost_cents = excluded.cost_cents, updated_at = now();
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_change', 'menu_item', _item_id,
          jsonb_build_object('from', _old, 'to', _cost_cents));
end;
$$;

create or replace function public.set_variant_cost(_variant_id uuid, _cost_cents integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _old integer;
begin
  select tenant_id into _tenant from public.item_variants where id = _variant_id;
  if _tenant is null then
    raise exception 'variant not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cost_cents is not null and (_cost_cents < 0 or _cost_cents > 100000000) then
    raise exception 'cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  select cost_cents into _old from public.item_variant_costs where variant_id = _variant_id;
  if _old is not distinct from _cost_cents then
    return;
  end if;

  if _cost_cents is null then
    delete from public.item_variant_costs where variant_id = _variant_id;
  else
    insert into public.item_variant_costs (variant_id, tenant_id, cost_cents)
    values (_variant_id, _tenant, _cost_cents)
    on conflict (variant_id) do update set cost_cents = excluded.cost_cents, updated_at = now();
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_change', 'item_variant', _variant_id,
          jsonb_build_object('from', _old, 'to', _cost_cents));
end;
$$;

-- Stamp today's cost onto past lines that have none. Only rows without a
-- snapshot are touched, so it is safe to run again after entering more costs.
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
  cross join lateral (select public.effective_item_cost_cents(oi.item_id, oi.variant_id) as cents) c
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

-- Same signatures as part 1 → grants carry; re-issued anyway (house rule).
do $$
declare _sig text;
begin
  foreach _sig in array array[
    'public.set_item_cost(uuid, integer)',
    'public.set_variant_cost(uuid, integer)',
    'public.backfill_order_item_costs(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', _sig);
    execute format('revoke all on function %s from anon', _sig);
    execute format('grant execute on function %s to authenticated', _sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reports: join order_item_costs, bigint before multiply. Same signatures.
-- ---------------------------------------------------------------------------
create or replace function public.report_sales(
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
    select coalesce(sum(bi.qty::bigint * oi.unit_cost_cents), 0)::bigint as cogs_cents,
           count(*) filter (where oi.unit_cost_cents is null)::bigint as uncosted_lines
    from public.bill_items bi
    join paid p on p.id = bi.bill_id
    left join public.order_item_costs oi on oi.order_item_id = bi.order_item_id
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
  select g.description, g.qty, g.revenue_cents, g.cost_cents, g.revenue_cents - g.cost_cents
  from g
  order by g.revenue_cents desc
  limit greatest(1, least(100, _limit))
  offset greatest(0, _offset);
$$;

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
