-- ============================================================================
-- Restore a permission guard `create or replace` silently reverted, and close
-- the last two report RPCs that never had one.
--
-- Found 2026-07-31 by comparing every `has_permission` the migrations *intend*
-- against what `pg_proc.prosrc` actually holds on the live project. A grep of
-- the repo cannot find this class of bug — only the catalog can, because the
-- bug is that a later migration overwrote an earlier one's guard.
--
-- 1. `apply_bill_discount` — REGRESSION.
--
--    `20260712100000_rpc_permission_checks.sql:43` added
--    `has_permission(_tenant, 'order.discount')`. Then
--    `20260713100000_item_discounts_coupons.sql:35` redefined the body without
--    it, and `20260722120000_checkout_extras.sql:104` redefined it again, still
--    without it. Neither redefinition was trying to change authorization; both
--    were rewriting the discount maths and carried a stale copy of the body
--    forward. `create or replace` does not warn you that you have just deleted
--    a security check.
--
-- 2. `apply_item_discount` — GAP, never guarded.
--
--    Created in `20260713100000` with a role check only. Same money operation
--    as (1) at line granularity, so it takes the same key.
--
--    For both: the role check stays. It is the floor — `has_permission` refines
--    within a base role, it does not replace it. A custom role with
--    `order.discount` revoked but a manager base_role could discount a bill
--    straight through the API until now; the UI hid the control, which is the
--    guard-in-the-client shape closed three times already (86/table-state,
--    revenue, inventory ops).
--
-- 3. `report_by_branch` + `report_top_items` — the 8th and 9th report RPCs.
--
--    `20260712120000_report_fixes.sql` set out to "add reports.view guard to
--    every report RPC (direct-API defense)" and covered six. `report_sales` was
--    the 7th, fixed 2026-07-30. These two are the rest of it. Both read
--    `bills` (revenue per branch; revenue per dish), whose RLS is tenant-scoped
--    only, while `reports.view` is Owner/Manager — so any member of a
--    restaurant could read the takings through either one.
--
--    Guarded the same way `report_sales` was: the predicate goes in the WHERE
--    clause, so an unauthorized caller gets **zero rows rather than an error**
--    and a surface can degrade instead of exploding. Same arity in all four
--    cases, so `create or replace` is safe and existing grants carry over.
--
-- No caller regresses: `/reports` already does `requirePermission("reports.view")`
-- and the discount controls are already behind `useHasPermission`.
-- ============================================================================

-- 1. apply_bill_discount — body is the live 20260722120000 version, guard restored.
create or replace function public.apply_bill_discount(
  _bill_id uuid,
  _type    public.discount_type,
  _value   numeric,
  _reason  text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _total integer;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, _type, _value, _reason, auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- 2. apply_item_discount — same body, guard added.
create or replace function public.apply_item_discount(
  _order_item_id uuid,
  _type          public.discount_type,
  _value         numeric,
  _reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _order uuid; _bill uuid; _bill_status public.bill_status;
begin
  select tenant_id, order_id into _tenant, _order from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;
  select bill_id into _bill from public.orders where id = _order;
  if _bill is null then raise exception 'item is not on a bill yet' using errcode = '22023'; end if;
  select status into _bill_status from public.bills where id = _bill;
  if _bill_status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;

  insert into public.discounts (tenant_id, bill_id, order_item_id, type, value, reason, approved_by)
  values (_tenant, _bill, _order_item_id, _type, _value, _reason, auth.uid());

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'order_item', _order_item_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  perform public.recompute_bill(_bill);
end $$;

-- 3. The last two unguarded report RPCs.
create or replace function public.report_by_branch(
  _tenant uuid,
  _from   timestamptz,
  _to     timestamptz
)
returns table (branch_id uuid, branch_name text, revenue_cents bigint, orders bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select b.branch_id, coalesce(br.name, 'Unassigned'),
         sum(b.total_cents)::bigint, count(*)::bigint
  from public.bills b
  left join public.branches br on br.id = b.branch_id
  where b.tenant_id = _tenant and b.status = 'paid'
    and b.created_at >= _from and b.created_at < _to
    and public.has_permission(_tenant, 'reports.view')
  group by b.branch_id, br.name
  order by 3 desc;
$$;

create or replace function public.report_top_items(
  _tenant uuid,
  _from   timestamptz,
  _to     timestamptz,
  _limit  integer default 10,
  _offset integer default 0
)
returns table (description text, qty bigint, revenue_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select bi.description, sum(bi.qty)::bigint, sum(bi.total_cents)::bigint
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  where b.tenant_id = _tenant and b.status = 'paid'
    and b.created_at >= _from and b.created_at < _to
    and public.has_permission(_tenant, 'reports.view')
  group by bi.description
  order by 3 desc
  limit greatest(1, least(100, _limit))
  offset greatest(0, _offset);
$$;

-- ACLs. Same signatures, so the existing grants carry — re-issued anyway
-- because `public` holds EXECUTE by default and "revoke from anon alone does
-- nothing": the grant nobody wrote is the one that bites.
revoke execute on function public.apply_bill_discount(uuid, public.discount_type, numeric, text) from public, anon;
grant  execute on function public.apply_bill_discount(uuid, public.discount_type, numeric, text) to authenticated;

revoke execute on function public.apply_item_discount(uuid, public.discount_type, numeric, text) from public, anon;
grant  execute on function public.apply_item_discount(uuid, public.discount_type, numeric, text) to authenticated;

revoke execute on function public.report_by_branch(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_by_branch(uuid, timestamptz, timestamptz) to authenticated;

revoke execute on function public.report_top_items(uuid, timestamptz, timestamptz, integer, integer) from public, anon;
grant  execute on function public.report_top_items(uuid, timestamptz, timestamptz, integer, integer) to authenticated;
