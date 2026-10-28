-- ============================================================================
-- A cancelled bill must stay cancelled — on every path, not just record_payment.
--
-- 155724 made record_payment refuse a bill that cancel_order voided, but it
-- inferred "cancelled" from "void with no refunded payment" (fail-open if an
-- open bill ever carried an old refunded row), and it left the other settle
-- paths alone. public_pay_order — executable by anon — takes an order id,
-- _build_bill_for_order hands back the order's existing (void) bill before it
-- checks the order's status, and the rollup then wrote status = 'paid' over it
-- and closed the cancelled order, freeing the table.
--
--   * bills.cancelled_at: set only by cancel_order when it voids a bill.
--   * trg_bills_cancel_marks (BEFORE UPDATE, every caller): once cancelled_at is
--     set, status can't leave 'void' and cancelled_at can't change. That closes
--     public_pay_order, redeem_points_for_bill, the gateway webhook and direct
--     writes in one place; the whole statement rolls back, payment rows and
--     points burns included.
--   * The same trigger stops an API caller (authenticated/anon, i.e. not a
--     definer function) from stamping cancelled_at or credit_left_at itself.
--     RLS on bills is still tenant-wide (tenant_all), so these two columns are
--     the only ones protected here; tightening the rest is a separate change.
--   * record_payment checks the explicit marker instead of the inference.
--
-- Same signatures as before, so `create or replace` is safe; grants re-issued.
-- ============================================================================

alter table public.bills add column if not exists cancelled_at timestamptz;

create or replace function public.guard_bill_cancel_marks()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.cancelled_at is not null then
    if new.status is distinct from 'void' or new.cancelled_at is distinct from old.cancelled_at then
      raise exception 'this bill was cancelled and can no longer change' using errcode = '22023';
    end if;
  end if;
  -- current_user is the function owner inside a security-definer RPC, and the
  -- API role (authenticated/anon) for a direct write through PostgREST.
  if current_user in ('authenticated', 'anon')
     and (new.cancelled_at is distinct from old.cancelled_at
          or new.credit_left_at is distinct from old.credit_left_at) then
    raise exception 'cancelled_at and credit_left_at are set by the server only' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_bills_cancel_marks on public.bills;
create trigger trg_bills_cancel_marks
  before update on public.bills
  for each row execute function public.guard_bill_cancel_marks();

create or replace function public.record_payment(_bill_id uuid, _method public.payment_method, _amount_cents integer, _idempotency_key text default null, _reference text default null)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _total integer; _paid integer; _paid_before integer; _apply integer; _status public.bill_status; _ref text; _bstatus public.bill_status; _cancelled timestamptz;
begin
  -- Locked: serialises with cancel_order, which voids a bill only after
  -- looking for payments. Without this a payment could land between its check
  -- and its void, then flip the voided bill back to paid.
  select tenant_id, total_cents, status, cancelled_at into _tenant, _total, _bstatus, _cancelled
  from public.bills where id = _bill_id for update;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'payment must be positive' using errcode = '22023'; end if;

  -- Marked explicitly by cancel_order. (A fully refunded bill is also 'void'
  -- but is not cancelled, and stays payable as before.)
  if _cancelled is not null then
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
  _branch uuid;
  _bill_status public.bill_status;
  _bill_total integer;
  _bill_credit timestamptz;
  _bill_outcome text;
  _lines text[];
begin
  select tenant_id, status, table_id, bill_id, branch_id
    into _tenant, _status, _table, _bill, _branch
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
    select status, total_cents, credit_left_at
      into _bill_status, _bill_total, _bill_credit
    from public.bills where id = _bill for update;
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
    -- A tab left on credit is a debt; cancelling would erase it.
    if _bill_credit is not null and coalesce(_bill_total, 0) > 0 then
      raise exception 'this bill was left on credit — settle it before cancelling'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(array_agg(id::text), '{}') into _lines
  from public.order_items where order_id = _order_id and is_void = false;

  update public.order_items
  set is_void = true, void_reason = _reason
  where order_id = _order_id and is_void = false;

  -- Give back the stock the kitchen fire deducted — same reversal as
  -- void_order_item, skipping any line already reversed.
  with s as (
    select sm.reference, sm.inventory_item_id, sum(sm.qty) as total
    from public.stock_movements sm
    where sm.tenant_id = _tenant and sm.type = 'sale' and sm.reference = any (_lines)
      and not exists (
        select 1 from public.stock_movements r
        where r.tenant_id = _tenant and r.reference = 'void:' || sm.reference
      )
    group by sm.reference, sm.inventory_item_id
  ), ins as (
    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select _tenant, _branch, s.inventory_item_id, 'adjustment', -s.total, 'void:' || s.reference
    from s
    returning 1
  )
  update public.inventory_items i
  set current_qty = i.current_qty - t.total
  from (select inventory_item_id, sum(total) as total from s group by inventory_item_id) t
  where i.id = t.inventory_item_id;

  update public.orders set status = 'cancelled' where id = _order_id;

  if _status = 'billed' and _bill is not null then
    if exists (select 1 from public.orders o
               where o.bill_id = _bill and o.id <> _order_id
                 and o.status not in ('closed', 'cancelled')) then
      update public.orders set bill_id = null where id = _order_id;
      perform public.recompute_bill(_bill);
      _bill_outcome := 'detached';
    else
      update public.bills set status = 'void', cancelled_at = now() where id = _bill;
      _bill_outcome := 'voided';

      -- Give back the coupon use the bill was holding (remove_coupon does the
      -- same when a coupon is taken off by hand). A bill that is only detached
      -- keeps its coupon: it still has a live order.
      with d as (
        delete from public.discounts
        where bill_id = _bill and coupon_id is not null
        returning coupon_id
      )
      update public.coupons c
      set used_count = greatest(c.used_count - x.n, 0)
      from (select coupon_id, count(*)::int as n from d group by coupon_id) x
      where c.id = x.coupon_id;
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
