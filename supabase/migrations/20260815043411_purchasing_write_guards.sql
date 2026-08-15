-- ============================================================================
-- Purchasing write guards.
--
-- suppliers, purchase_orders, po_items and inventory_items each carried the
-- generic `tenant_all` policy — one `for all` whose only test is tenant
-- membership. Any active member's token could DELETE a purchase order or PATCH
-- a supplier straight through PostgREST. The role checks in the server actions
-- guard the button, not the table. Same hole 20260814170000_menu_write_guards
-- closed on the menu tables, from the same generic applier, never narrowed here.
--
-- Applied AFTER the rewritten actions and UI, not before: creating a supplier
-- and adding a line were direct writes until this point, so landing this first
-- would have broken the screen for everyone.
--
-- Note on how a refusal shows up. Where a table keeps a write policy, RLS
-- *filters rows* — an unauthorised UPDATE or DELETE affects 0 rows rather than
-- raising. Where the grant itself is revoked, the caller gets 42501. Both are
-- refusals; only the second is loud. Tests must assert row counts, not just
-- exceptions.
-- ============================================================================

-- purchase_orders and po_items: reads open, no write policy at all.
-- Every mutation is a status-machine step. A direct status='received' would
-- fabricate a delivery without moving any stock and corrupt supplier_balances;
-- a direct qty_received would do the same at line level. Neither is something
-- a policy can express, so there is no write policy to express it with.
do $$ declare _t text; begin
  foreach _t in array array['purchase_orders','po_items'] loop
    execute format('drop policy if exists tenant_all on public.%I', _t);
    execute format('drop policy if exists tenant_read on public.%I', _t);
    execute format(
      'create policy tenant_read on public.%I for select to authenticated '
      'using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())', _t);
    execute format('revoke insert, update, delete on public.%I from authenticated', _t);
  end loop;
end $$;

-- suppliers: a name is a name and archived_at is a timestamp, so a policy
-- expresses the whole rule for insert and update — and leaving them direct is
-- what keeps a future mobile client working without a second API. Delete is
-- different: it needs a *second* permission, and it has to refuse on
-- referencing rows with a message a human can act on. So no delete policy.
drop policy if exists tenant_all on public.suppliers;
drop policy if exists tenant_read on public.suppliers;
create policy tenant_read on public.suppliers for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy tenant_write_insert on public.suppliers for insert to authenticated
  with check ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'purchasing.edit')) or public.is_platform_admin());
create policy tenant_write_update on public.suppliers for update to authenticated
  using ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'purchasing.edit')) or public.is_platform_admin())
  with check ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'purchasing.edit')) or public.is_platform_admin());
revoke delete on public.suppliers from authenticated;

-- inventory_items: /inventory writes these directly today and every role that
-- can reach that screen holds inventory.edit, so an RPC round-trip would buy
-- nothing. current_qty stays client-writable, which is a separate gap noted in
-- TASKS.md — closing it needs a trigger that can tell a definer caller apart.
drop policy if exists tenant_all on public.inventory_items;
drop policy if exists tenant_read on public.inventory_items;
create policy tenant_read on public.inventory_items for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());
create policy tenant_write_insert on public.inventory_items for insert to authenticated
  with check ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin());
create policy tenant_write_update on public.inventory_items for update to authenticated
  using ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin())
  with check ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin());
create policy tenant_write_delete on public.inventory_items for delete to authenticated
  using ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin());
