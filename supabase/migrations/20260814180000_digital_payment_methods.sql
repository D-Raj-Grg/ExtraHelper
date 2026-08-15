-- ============================================================================
-- Digital payment methods (record-only) + a payment reference.
--
-- Nepal restaurants settle most non-cash bills through a wallet or bank QR the
-- guest scans: eSewa, FonePay, a bank transfer. There is no API call behind any
-- of them here — the cashier sees the guest's confirmation and records what was
-- taken, exactly as they already do for a card on a terminal. That means these
-- methods queue offline like cash and card; only 'online' (the gateway adapter
-- in lib/integrations/payments.ts) needs a connection.
--
-- 'wallet' and 'points' already existed. 'wallet' stays as the catch-all for a
-- provider we haven't named (Khalti, IME Pay, ConnectIPS).
--
-- The reference is the guest-side transaction id the cashier reads off the
-- phone. payments.reference has existed since the billing migration and has
-- never been written; record_payment now carries it, which is what makes a
-- digital payment reconcilable against the wallet's own statement.
-- ============================================================================

alter type public.payment_method add value if not exists 'esewa';
alter type public.payment_method add value if not exists 'fonepay';
alter type public.payment_method add value if not exists 'bank';

-- ----------------------------------------------------------------------------
-- record_payment gains _reference. A new arg list is a new function object, so
-- `create or replace` would leave the 4-arg body live as an overload and
-- PostgREST would resolve to whichever matched — drop first, then re-issue the
-- grants naming the full new signature (public holds EXECUTE by default).
--
-- Callers that pass four named args still resolve: _reference defaults to null.
--
-- Both signatures are dropped, not just the old one: on a database where this
-- migration has already run, dropping only the 4-arg form leaves the 5-arg one
-- standing and the `create` below fails with "function already exists". A
-- migration that cannot be re-applied to an already-migrated database is a
-- migration that breaks the next `db push`.
-- ----------------------------------------------------------------------------
drop function if exists public.record_payment(uuid, public.payment_method, integer, text);
drop function if exists public.record_payment(uuid, public.payment_method, integer, text, text);

create function public.record_payment(
  _bill_id uuid,
  _method public.payment_method,
  _amount_cents integer,
  _idempotency_key text default null,
  _reference text default null
)
returns public.bill_status language plpgsql security definer set search_path = 'public'
as $function$
declare _tenant uuid; _total integer; _paid integer; _paid_before integer; _apply integer; _status public.bill_status; _ref text;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'payment must be positive' using errcode = '22023'; end if;

  -- A blank field is no reference, not an empty one. Capped so a paste of the
  -- whole wallet receipt doesn't land in a column meant for a txn id.
  _ref := nullif(btrim(coalesce(_reference, '')), '');
  if _ref is not null and length(_ref) > 120 then
    raise exception 'reference is too long' using errcode = '22001';
  end if;

  -- Balance already covered by OTHER payments (exclude this key so an idempotent
  -- replay recomputes against the same baseline it was clamped with).
  select coalesce(sum(amount_cents), 0) into _paid_before
  from public.payments
  where bill_id = _bill_id and status = 'completed'
    and (_idempotency_key is null or idempotency_key is distinct from _idempotency_key);

  -- Never apply more than what's outstanding.
  _apply := least(_amount_cents, greatest(0, _total - _paid_before));
  if _apply > 0 then
    insert into public.payments (tenant_id, bill_id, method, amount_cents, status, idempotency_key, reference)
    values (_tenant, _bill_id, _method, _apply, 'completed', _idempotency_key, _ref)
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill_id and status = 'completed';
  _status := case when _paid >= _total then 'paid' when _paid > 0 then 'partial' else 'open' end;
  update public.bills set status = _status where id = _bill_id;

  if _status = 'paid' then
    update public.orders set status = 'closed' where bill_id = _bill_id;
    update public.restaurant_tables t set state = 'free' from public.bills b where b.id = _bill_id and t.id = b.table_id;
  end if;

  return _status;
end $function$;

revoke execute on function public.record_payment(uuid, public.payment_method, integer, text, text) from anon, public;
grant execute on function public.record_payment(uuid, public.payment_method, integer, text, text) to authenticated;
