-- ============================================================================
-- Lock down the deduct trigger function. It got the default anon/authenticated
-- EXECUTE grant on creation (SECURITY DEFINER). The trigger fires regardless of
-- caller grants, so revoke all — nobody should RPC-call a trigger function.
-- (No live hole — Postgres blocks calling trigger fns directly — but least-priv
-- + clears advisor 0028.)
-- ============================================================================

revoke execute on function public.trg_deduct_stock() from anon, authenticated, public;
