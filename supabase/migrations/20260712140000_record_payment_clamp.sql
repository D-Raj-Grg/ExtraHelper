-- ============================================================================
-- Harden record_payment against OVERPAYMENT. Previously it inserted every
-- positive payment and only recomputed status, so a double-click race, a
-- mid-split discount, or a duplicate entry could push paid > total (corrupting
-- cash reconciliation). Now the applied amount is clamped to the outstanding
-- balance, and a payment against an already-settled bill is a graceful no-op.
-- Idempotency-safe: the same key still de-dups via the unique conflict.
-- ============================================================================

create or replace function public.record_payment(_bill_id uuid, _method public.payment_method, _amount_cents integer, _idempotency_key text default null)
returns public.bill_status language plpgsql security definer set search_path = 'public'
as $function$
declare _tenant uuid; _total integer; _paid integer; _paid_before integer; _apply integer; _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'payment must be positive' using errcode = '22023'; end if;

  -- Balance already covered by OTHER payments (exclude this key so an idempotent
  -- replay recomputes against the same baseline it was clamped with).
  select coalesce(sum(amount_cents), 0) into _paid_before
  from public.payments
  where bill_id = _bill_id and status = 'completed'
    and (_idempotency_key is null or idempotency_key is distinct from _idempotency_key);

  -- Never apply more than what's outstanding.
  _apply := least(_amount_cents, greatest(0, _total - _paid_before));
  if _apply > 0 then
    insert into public.payments (tenant_id, bill_id, method, amount_cents, status, idempotency_key)
    values (_tenant, _bill_id, _method, _apply, 'completed', _idempotency_key)
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
