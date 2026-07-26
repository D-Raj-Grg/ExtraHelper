-- Harden SECURITY DEFINER grants (matches the repo's lock_definer_execute
-- pattern). Postgres grants EXECUTE to PUBLIC by default; revoking from anon
-- alone leaves PUBLIC's grant in place. Internal helpers with no auth guard
-- must not be callable by anon/authenticated at all — the SECURITY DEFINER
-- functions that call them run as owner and are unaffected.

-- Internal, NO auth guard → callable only by other definer functions.
revoke execute on function public._build_bill_for_order(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_table_state(uuid, uuid) from public, anon, authenticated;

-- Self-guarded staff RPCs (has_tenant_role / user_tenants checks inside):
-- drop the implicit anon/PUBLIC grant, keep authenticated.
revoke execute on function public.transfer_order(uuid, uuid) from public, anon;
revoke execute on function public.split_order_items(uuid, uuid, uuid[]) from public, anon;
revoke execute on function public.receive_po_partial(uuid, jsonb) from public, anon;
revoke execute on function public.add_order_to_bill(uuid, uuid) from public, anon;
revoke execute on function public.mark_order_served(uuid) from public, anon;
revoke execute on function public.sync_order_status_from_kots(uuid) from public, anon;

-- public_pay_order + public_bill_quote intentionally remain anon-executable
-- (customer QR / storefront pay surfaces); they resolve tenant from the order
-- and only ever credit a bill (overpay-clamped).
