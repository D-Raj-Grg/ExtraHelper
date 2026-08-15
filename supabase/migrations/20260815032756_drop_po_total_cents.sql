-- ============================================================================
-- purchase_orders.total_cents has never been written by any migration, server
-- action, or component — it has always read 0. A column that looks
-- authoritative and is always wrong is worse than no column: the first report
-- that trusts it is silently wrong, and nothing about the schema warns you.
--
-- PO value is summed from po_items (qty_received * unit_cost_cents), which is
-- what supplier_balances() already does.
--
-- Verified before dropping: every total_cents reference in the web and Flutter
-- code is bills.total_cents, and the purchasing page selects an explicit column
-- list that does not include it.
-- ============================================================================

alter table public.purchase_orders drop column if exists total_cents;
