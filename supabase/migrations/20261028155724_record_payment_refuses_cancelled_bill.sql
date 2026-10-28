-- ============================================================================
-- cancel_order (billed orders) vs record_payment race.
--
-- record_payment never locked the bill: it inserted the payment first and only
-- touched `bills` afterwards. cancel_order locks the bill, checks for payments
-- and voids it — but couldn't see a payment still being inserted, so the void
-- could land mid-payment and record_payment would then flip the voided bill back
-- to 'paid' and close the cancelled order.
--
-- Now record_payment locks the bill row first (serialising with cancel_order)
-- and refuses a bill voided by a cancel. A fully *refunded* bill is also
-- 'void' but carries refunded payments, and stays payable exactly as before.
--
-- Same signature, so `create or replace` is safe; grants re-issued anyway.
-- ============================================================================

create or replace function public.record_payment(_bill_id uuid, _method public.payment_method, _amount_cents integer, _idempotency_key text default null, _reference text default null)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _total integer; _paid integer; _paid_before integer; _apply integer; _status public.bill_status; _ref text; _bstatus public.bill_status;
begin
  -- Locked: serialises with cancel_order, which voids a bill only after
  -- looking for payments. Without this a payment could land between its check
  -- and its void, then flip the voided bill back to paid.
  select tenant_id, total_cents, status into _tenant, _total, _bstatus
  from public.bills where id = _bill_id for update;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'payment must be positive' using errcode = '22023'; end if;

  -- A bill voided by cancelling its order has no payments on it; a fully
  -- refunded one has refunded payments and stays payable as before.
  if _bstatus = 'void'
     and not exists (select 1 from public.payments where bill_id = _bill_id and status = 'refunded') then
    raise exception 'this bill was cancelled' using errcode = '22023';
  end if;

  _ref := nullif(btrim(coalesce(_reference, '')), '');
  if _ref is not null and length(_ref) > 120 then
    raise exception 'reference is too long' using errcode = '22001';
  end if;

  select coalesce(sum(amount_cents), 0) into _paid_before
  from public.payments
  where bill_id = _bill_id and status = 'completed'
    and (_idempotency_key is null or idempotency_key is distinct from _idempotency_key);

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
end $$;

revoke execute on function public.record_payment(uuid, public.payment_method, integer, text, text) from anon, public;
grant execute on function public.record_payment(uuid, public.payment_method, integer, text, text) to authenticated;
