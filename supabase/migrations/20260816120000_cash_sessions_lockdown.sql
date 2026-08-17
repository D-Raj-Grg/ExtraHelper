-- ============================================================================
-- cash_sessions: read-only to clients.
--
-- The table carried the generic `tenant_all` policy — one `for all` whose only
-- test is tenant membership — so any member's token could PATCH a session
-- through PostgREST and set `counted_cents`, `variance_cents` or `status`
-- directly. Every guard in open_cash_session / close_cash_session was
-- decorative: the reconciliation those functions exist to protect could be
-- overwritten without calling them.
--
-- Nothing legitimate loses anything. Every writer is already a security
-- definer RPC and bypasses RLS: open_cash_session, close_cash_session, and
-- purge_tenant_data. Verified across both clients — the only references
-- anywhere are two selects in app/(app)/cash/page.tsx, and the Flutter app has
-- no cash surface at all.
--
-- Reads stay open to every tenant member: the drawer screen and the shift
-- reports depend on them, and the cash book about to be built reads them too.
--
-- Shipped first and alone, ahead of the cash book work, because it is the one
-- change in that batch that cannot break a working screen.
-- ============================================================================

drop policy if exists tenant_all on public.cash_sessions;

create policy tenant_read on public.cash_sessions
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

-- No insert/update/delete policy, deliberately: RLS denies by default. The
-- revoke is belt and braces, so the route fails at the grant even if a policy
-- is ever added back by mistake.
revoke insert, update, delete on public.cash_sessions from authenticated;
