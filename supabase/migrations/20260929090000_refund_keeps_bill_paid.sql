-- A refund hands money back; it never puts the guest in debt.
--
-- `refund_payment` (20260815032537) re-derived the bill's status from
-- payments minus refunds against the total, so a 10 refund on a 960 bill paid
-- in full flipped it to 'partial'. The guest owed nothing, yet the bill sat in
-- the outstanding-credit list, the web checkout offered the payment form
-- again, `customer_credit_summary` listed it with 0 owed, and — worst — the
-- whole 960 dropped out of `daily_report_core` (sales count 'paid' bills only)
-- while the 10 refund was still subtracted from profit.
--
-- Every other reader (`record_payment`, `redeem_points_for_bill`, the report,
-- the credit summary, both checkouts) computes "paid" from completed payments
-- alone. This aligns the writer with them: a partial refund leaves the status
-- as it was; only a refund that returns everything voids the bill (as before).
--
-- Same arity as the current definition, so `create or replace` is safe and the
-- existing grants stand.

create or replace function public.refund_payment(
  _bill_id      uuid,
  _amount_cents integer,
  _reason       text,
  _method       public.payment_method default null
)
returns public.bill_status
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  _tenant uuid; _total integer; _paid integer; _refunded integer;
  _net integer; _status public.bill_status; _method_resolved public.payment_method;
  _distinct integer;
begin
  select tenant_id, total_cents, status into _tenant, _total, _status
  from public.bills where id = _bill_id for update;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.refund') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _amount_cents <= 0 then
    raise exception 'refund must be positive' using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0) into _paid
  from public.payments where bill_id = _bill_id and status = 'completed';
  select coalesce(sum(amount_cents), 0) into _refunded
  from public.refunds where bill_id = _bill_id;

  if _amount_cents > _paid - _refunded then
    raise exception 'refund exceeds net paid' using errcode = '22023';
  end if;

  -- Caller wins. Otherwise infer, but only from a single-tender bill: guessing
  -- on a split bill would silently mis-state the drawer.
  _method_resolved := _method;
  if _method_resolved is null then
    select count(distinct method) into _distinct
    from public.payments where bill_id = _bill_id and status = 'completed';
    if _distinct = 1 then
      select method into _method_resolved
      from public.payments where bill_id = _bill_id and status = 'completed' limit 1;
    else
      raise exception 'this bill was paid by more than one method — say which one to refund'
        using errcode = '22023';
    end if;
  end if;

  insert into public.refunds (tenant_id, bill_id, amount_cents, reason, approved_by, method)
  values (_tenant, _bill_id, _amount_cents, _reason, auth.uid(), _method_resolved);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'refund', 'bill', _bill_id,
          jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason,
                             'method', _method_resolved));

  -- Everything back → void, as before. Anything less leaves the bill exactly
  -- as it was: a paid bill stays paid, a part-paid one stays part-paid.
  _net := _paid - (_refunded + _amount_cents);
  if _net <= 0 then
    _status := 'void';
    update public.bills set status = _status where id = _bill_id;
  end if;
  return _status;
end $function$;

-- Bills the old rule reopened: part-paid on paper, paid in full in fact, with
-- a refund on record. Nothing else to replay — orders closed and tables freed
-- when they were first paid.
update public.bills b set status = 'paid'
where b.status = 'partial'
  and (select coalesce(sum(p.amount_cents), 0) from public.payments p
        where p.bill_id = b.id and p.status = 'completed') >= b.total_cents
  and exists (select 1 from public.refunds r where r.bill_id = b.id);
