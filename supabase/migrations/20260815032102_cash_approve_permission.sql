-- ============================================================================
-- cash.approve.
--
-- The cashier role already holds cash.manage
-- (20260712091000_seed_system_roles.sql), so recording a payout reuses that key
-- — the person holding the cash is the one who knows what happened. Approval
-- CANNOT reuse it for exactly that reason: a cashier with cash.manage would
-- approve their own payouts and the review step would be decorative.
--
-- default_role_permissions gives owner every key and manager every key except
-- billing.view, so both pick this up automatically for members whose role_id is
-- null. Members pointed at a system role carry explicit role_permissions rows
-- and need the backfill below. The cashier role must NOT receive it.
-- ============================================================================

insert into public.permissions (key, grp, label, sort) values
  ('cash.approve','Order','Approve cash payouts',215)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'cash.approve'
from public.roles r
where r.is_system and r.base_role in ('owner', 'manager')
on conflict do nothing;
