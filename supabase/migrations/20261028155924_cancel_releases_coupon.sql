-- ============================================================================
-- Cancelling a billed order that held a coupon burned a use of that coupon.
--
-- apply_coupon increments coupons.used_count when the coupon goes on a bill;
-- remove_coupon decrements it. cancel_order voided the bill without either, so
-- a capped campaign lost a redemption for a bill nobody paid. Voiding the bill
-- now deletes its coupon discount rows and releases the use, as remove_coupon
-- does. A bill that is merely detached (other live orders remain) is untouched.
--
-- Same signature; `create or replace` is safe, grants re-issued anyway.
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
      update public.bills set status = 'void' where id = _bill;
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
