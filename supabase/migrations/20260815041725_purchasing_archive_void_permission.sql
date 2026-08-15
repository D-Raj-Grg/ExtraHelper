-- ============================================================================
-- Supplier archiving, payment voiding, the delete permission, and two data
-- fixes found while designing the rebuilt purchasing screen.
-- ============================================================================

-- archived_at, not is_archived: "when" is free and audit-useful, and null is an
-- honest "not archived" rather than a flag nobody set.
alter table public.suppliers add column if not exists archived_at timestamptz;
create index if not exists idx_suppliers_active
  on public.suppliers(tenant_id) where archived_at is null;

-- A payment is never deleted and never negated (amount_cents is check > 0, and
-- a hole in a reconciliation is worse than a marked row). It is voided.
alter table public.supplier_payments
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

-- purchasing.delete, not a reuse of purchasing.edit: the inventory role holds
-- purchasing.edit, and the store keeper who raises orders must not be able to
-- erase a supplier the books still reference or reverse a receipt. Same
-- reasoning that kept cash.approve off cash.manage.
--
-- default_role_permissions gives owner every key and manager every key except
-- billing.view, so both pick this up automatically for members whose role_id is
-- null. The inventory role's list is hardcoded and does not include it, which
-- is exactly what we want. Members pointed at a system role need the backfill.
insert into public.permissions (key, grp, label, sort) values
  ('purchasing.delete','Inventory','Delete suppliers & reverse receipts',275)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'purchasing.delete'
from public.roles r
where r.is_system and r.base_role in ('owner','manager')
on conflict do nothing;

-- Adding the same ingredient twice is a re-quote or a correction, never a
-- second row — but there was no constraint, so both rows were accepted and both
-- received independently. Verified zero duplicates in live data before adding.
-- Partial: inventory_item_id is nullable (ON DELETE SET NULL), and two orphaned
-- lines on one order are not duplicates of each other.
create unique index if not exists po_items_po_item_uniq
  on public.po_items (po_id, inventory_item_id)
  where inventory_item_id is not null;

-- createPO never passed a branch, so every UI-created order has branch_id null
-- — and record_supplier_payment reads its branch from the order, so every cash
-- payout has been stamped with no branch too. The new create_po resolves the
-- default; these are the rows that predate it.
update public.purchase_orders po
set branch_id = b.id
from public.branches b
where po.branch_id is null and b.tenant_id = po.tenant_id and b.is_default;

update public.supplier_payments sp
set branch_id = b.id
from public.branches b
where sp.branch_id is null and b.tenant_id = sp.tenant_id and b.is_default;
