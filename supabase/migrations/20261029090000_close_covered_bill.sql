-- A bill whose total fell to (or below) what was already paid — every dish
-- voided after a part payment, a discount larger than the balance — had no way
-- to finish: record_payment refuses a payment of 0, so the bill stayed
-- `partial` and held its table. close_covered_bill is the "keep the money"
-- exit (the other exit is refund_payment, then cancel_order).
--
-- The overage becomes tip so total == money held and every report that reads
-- bills.total_cents or payments agrees. Then the same paid branch as
-- record_payment: orders closed, table freed.

create or replace function public.close_covered_bill(_bill_id uuid)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid; _status public.bill_status; _total integer; _tip integer;
  _cancelled timestamptz; _credit timestamptz;
  _held integer;
begin
  select tenant_id, status, total_cents, coalesce(tip_cents, 0), cancelled_at, credit_left_at
    into _tenant, _status, _total, _tip, _cancelled, _credit
  from public.bills where id = _bill_id for update;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cancelled is not null then raise exception 'this bill was cancelled' using errcode = '22023'; end if;
  if _status not in ('open', 'partial') then
    raise exception 'bill is already %', _status using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where bill_id = _bill_id and status = 'pending') then
    raise exception 'a payment on this bill is still pending — wait for it to clear' using errcode = '22023';
  end if;

  select coalesce((select sum(amount_cents) from public.payments
                    where bill_id = _bill_id and status = 'completed'), 0)
       - coalesce((select sum(amount_cents) from public.refunds where bill_id = _bill_id), 0)
    into _held;
  if _held <= 0 or _held < _total then
    raise exception 'this bill still has an amount to pay' using errcode = '22023';
  end if;
  if _credit is not null and _total > 0 then
    raise exception 'this bill was left on credit — settle it instead' using errcode = '22023';
  end if;

  if _held > _total then
    update public.bills set tip_cents = _tip + (_held - _total) where id = _bill_id;
    perform public.recompute_bill(_bill_id);
  end if;

  update public.bills set status = 'paid' where id = _bill_id;
  update public.orders set status = 'closed' where bill_id = _bill_id and status = 'billed';
  update public.restaurant_tables t set state = 'free', current_order_id = null
    from public.bills b where b.id = _bill_id and t.id = b.table_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'bill_closed_covered', 'bill', _bill_id,
          jsonb_build_object('held_cents', _held, 'total_before_cents', _total));
  return 'paid';
end $$;

revoke all on function public.close_covered_bill(uuid) from public, anon;
grant execute on function public.close_covered_bill(uuid) to authenticated;
