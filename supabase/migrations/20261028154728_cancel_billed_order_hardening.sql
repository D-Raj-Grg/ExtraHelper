-- ============================================================================
-- A billed order whose lines were all voided could never be cleared.
--
-- Voiding the last line of a 'billed' order leaves the bill 'open' at total 0
-- and the order 'billed', so the table stays on bill_requested forever:
-- cancel_order refused 'billed', record_payment rejects 0, leave_bill_on_credit
-- needs a customer, and set_table_state('free') refuses while a live order sits
-- on the table.
--
-- cancel_order now accepts a billed order when its bill is still discardable —
-- 'open' with no completed payment (the predicate the amend RPCs use). Anything
-- with money taken (partial/paid) still has to be refunded first.
--   * bill shared with other live orders -> detach this order, recompute the bill
--   * bill is only this order's           -> bill becomes 'void'
--
-- A payment still 'pending' (gateway in flight) also blocks the cancel, and the
-- order + bill rows are locked for the duration.
--
-- Same arity, so `create or replace` is safe (grants re-issued anyway).
-- ============================================================================

create or replace function public.cancel_order(_order_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _status public.order_status;
  _table uuid;
  _bill uuid;
  _bill_status public.bill_status;
  _bill_outcome text;
begin
  select tenant_id, status, table_id, bill_id into _tenant, _status, _table, _bill
  from public.orders where id = _order_id
  for update;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'cancels require a manager' using errcode = '42501';
  end if;
  if coalesce(trim(_reason), '') = '' then
    raise exception 'cancel reason is required' using errcode = '22023';
  end if;
  if _status in ('closed', 'cancelled') then
    raise exception 'order can no longer be cancelled' using errcode = '22023';
  end if;

  if _status = 'billed' and _bill is not null then
    -- Locked so a payment being recorded right now can't slip in between this
    -- check and the void below.
    select status into _bill_status from public.bills where id = _bill for update;
    if _bill_status is distinct from 'open'
       or exists (select 1 from public.payments p
                  where p.bill_id = _bill and p.status = 'completed') then
      raise exception 'this bill has payments on it — refund them before cancelling'
        using errcode = '22023';
    end if;
    -- A gateway payment still in flight would complete later and the webhook
    -- would mark this voided bill paid. Wait for it to settle or fail.
    if exists (select 1 from public.payments p
               where p.bill_id = _bill and p.status = 'pending') then
      raise exception 'a payment on this bill is still pending — wait for it to clear before cancelling'
        using errcode = '22023';
    end if;
  end if;

  update public.order_items
  set is_void = true, void_reason = _reason
  where order_id = _order_id and is_void = false;

  update public.orders set status = 'cancelled' where id = _order_id;

  if _status = 'billed' and _bill is not null then
    if exists (select 1 from public.orders o
               where o.bill_id = _bill and o.id <> _order_id
                 and o.status not in ('closed', 'cancelled')) then
      update public.orders set bill_id = null where id = _order_id;
      perform public.recompute_bill(_bill);
      _bill_outcome := 'detached';
    else
      update public.bills set status = 'void' where id = _bill;
      _bill_outcome := 'voided';
    end if;
  end if;

  -- Frees the table when this was its last live order; otherwise re-points
  -- current_order_id at whatever is still open there (split/merged tables).
  perform public.refresh_table_state(_table, _tenant);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cancel', 'order', _order_id,
          jsonb_strip_nulls(jsonb_build_object(
            'reason', _reason, 'bill_id', _bill, 'bill', _bill_outcome)));
end $$;

revoke execute on function public.cancel_order(uuid, text) from anon, public;
grant execute on function public.cancel_order(uuid, text) to authenticated;
