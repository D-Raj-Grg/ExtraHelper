-- Restore the EXECUTE invariant across every function that had drifted.
--
-- CLAUDE.md's rule: a `security definer` function needs `revoke execute from
-- public` plus an explicit grant, because **`public` holds EXECUTE by default
-- and revoking from `anon` alone does nothing**. An audit of the grants the
-- Flutter client now depends on found 32 functions in `public` reachable by
-- `anon` — most of them because `public` was never revoked at all.
--
-- Nothing here was exploitable. Every affected `security definer` function
-- either returns immediately when `auth.uid()` is null (`claim_invites`) or
-- filters every branch on `auth.uid()` (`get_my_permissions`, `has_permission`
-- and the member RPCs), and `is_platform_admin()` is itself uid-filtered. This
-- closes the gap between what the rule says and what the database does, so the
-- next function written to this pattern is safe by default rather than safe by
-- accident.
--
-- Three groups, and the difference matters:
--
--   1. **Customer-facing.** `anon` calls these for real, from `/t`, `/s`,
--      `/book` and `/pay` (`app/pay/actions.ts` runs as the anon role by
--      design). They keep their grant; only `public` is revoked.
--   2. **Staff-only.** No anonymous caller has any business here, so `anon`
--      loses EXECUTE along with `public`.
--   3. **Trigger functions.** Not callable through PostgREST at all, and
--      PostgreSQL does not check EXECUTE when a trigger fires — revoked for
--      consistency, with no behavioural change.
--
-- Verified before writing this: every RLS policy that calls `has_permission`
-- is scoped to the `authenticated` role, so no anonymous query evaluates it.
-- Nested calls inside a `security definer` body are checked against the
-- owner's privileges, not the caller's, so the customer-facing RPCs are
-- unaffected by the staff-only revokes.

-- ── 1. Customer-facing: revoke `public`, keep `anon` ────────────────────────
revoke execute on function public.public_bill_quote(uuid) from public;
revoke execute on function public.public_pay_order(uuid, text) from public;
revoke execute on function public.public_record_pending(uuid, text) from public;

grant execute on function public.public_bill_quote(uuid) to anon, authenticated;
grant execute on function public.public_pay_order(uuid, text) to anon, authenticated;
grant execute on function public.public_record_pending(uuid, text) to anon, authenticated;

-- ── 2. Staff-only: revoke `public` and `anon` ───────────────────────────────
revoke execute on function public.add_member_by_email(uuid, text, uuid) from public, anon;
revoke execute on function public.approve_member(uuid, uuid) from public, anon;
revoke execute on function public.cancel_invite(uuid, text) from public, anon;
revoke execute on function public.claim_invites() from public, anon;
revoke execute on function public.get_my_permissions(uuid) from public, anon;
revoke execute on function public.has_permission(uuid, text) from public, anon;
revoke execute on function public.list_tenant_members(uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.rename_inventory_unit(uuid, text) from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, uuid) from public, anon;
revoke execute on function public.report_staff(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_customers(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_extras(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_inventory(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_payments(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.report_sales_by_bill(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke execute on function public.report_sales_by_category(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.bill_discount_total(uuid, integer) from public, anon;
revoke execute on function public.default_role_permissions(public.app_role) from public, anon;

grant execute on function public.add_member_by_email(uuid, text, uuid) to authenticated;
grant execute on function public.approve_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_invite(uuid, text) to authenticated;
grant execute on function public.claim_invites() to authenticated;
grant execute on function public.get_my_permissions(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.list_tenant_members(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.rename_inventory_unit(uuid, text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, uuid) to authenticated;
grant execute on function public.report_staff(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_customers(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_extras(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_inventory(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_payments(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_sales_by_bill(uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.report_sales_by_category(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.bill_discount_total(uuid, integer) to authenticated;
grant execute on function public.default_role_permissions(public.app_role) to authenticated;

-- ── 3. Trigger functions: nothing calls these directly ──────────────────────
revoke execute on function public.set_updated_at() from public, anon;
revoke execute on function public.seed_default_inventory_units() from public, anon;
revoke execute on function public.cash_movement_tenant_matches_session() from public, anon;
