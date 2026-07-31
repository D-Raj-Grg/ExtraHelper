-- ============================================================================
-- The report guard that fix #5 (2026-07-12, `20260712120000_report_fixes.sql`)
-- missed.
--
-- That migration's stated goal was "add reports.view permission guard to every
-- report RPC (direct-API defense)". It covered report_sales_by_bill,
-- by_category, inventory, staff, customers and extras — but not `report_sales`
-- itself, which is the one that returns the headline revenue number. `bills` RLS
-- is tenant-scoped only (`tenant_all`), and `reports.view` is Owner/Manager
-- only, so until now any member of a restaurant — waiter, cook — could read the
-- day's takings straight through the API.
--
-- Same arity, so a plain `create or replace`; the existing grants carry over.
-- Its only caller is `components/reports/sales-tab.tsx`, reached from
-- `app/(app)/reports/page.tsx`, which already does
-- `requirePermission("reports.view")` — so nothing regresses.
--
-- Also tightening the ACL: the original migration only granted to
-- `authenticated` and never revoked, so `public` (and therefore `anon`) held
-- EXECUTE by default. Harmless in practice — the function is SECURITY INVOKER
-- and RLS gives anon no rows — but "revoke from anon alone does nothing" cuts
-- both ways: the grant nobody wrote is the one that bites.
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
    and created_at < _to
    and public.has_permission(_tenant, 'reports.view');
$$;

revoke execute on function public.report_sales(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_sales(uuid, timestamptz, timestamptz) to authenticated;
