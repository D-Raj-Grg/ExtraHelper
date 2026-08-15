-- ============================================================================
-- stock_movements: read-only to clients.
--
-- The table carried the generic `tenant_all` policy — one `for all` whose only
-- test is tenant membership — so any member's token could POST a row straight
-- through PostgREST and invent a 500kg flour delivery, or delete the evidence
-- of a real one. The ledger that every stock figure is derived from was
-- writable by a waiter.
--
-- Nothing legitimate loses anything. Every writer of this table is already a
-- security definer RPC and bypasses RLS: receive_po, receive_po_partial,
-- adjust_inventory, post_stock_count, the void/waste paths, and the new
-- correct_po_receipt. Verified across the web app and the Flutter client —
-- the only Dart reference to inventory is a select.
--
-- Reads stay open to every tenant member: the store room screen, the reorder
-- report and the offline cache all depend on them.
--
-- Shipped ahead of the rest of the purchasing work because it is the one
-- change here that cannot break a working screen.
-- ============================================================================

drop policy if exists tenant_all on public.stock_movements;

create policy tenant_read on public.stock_movements
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

-- No insert/update/delete policy, deliberately: RLS denies by default. The
-- revoke is belt and braces, so the route fails at the grant even if a policy
-- is ever added back by mistake.
revoke insert, update, delete on public.stock_movements from authenticated;
