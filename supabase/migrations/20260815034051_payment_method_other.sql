-- ============================================================================
-- payment_method gains 'other'.
--
-- Supplier payments reuse this enum, and they have a case guest payments do not:
-- money that did not come from the till at all. A delivery paid at 6am from the
-- owner's own pocket, before any drawer was open, is real and has to be
-- recordable — otherwise it is either lost or falsely attributed to a shift.
--
-- This does NOT appear at checkout. The till renders PAYMENT_METHODS in
-- lib/payment-constants.ts, an explicit list, not the enum.
-- ============================================================================

alter type public.payment_method add value if not exists 'other';
