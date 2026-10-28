-- ============================================================================
-- Two gaps left by cancel_order (20261028154242 / ...154728):
--
-- 1. Stock. cancel_order voided its lines in bulk and never reversed the
--    `sale` stock movements the kitchen fire booked, unlike void_order_item. Every
--    cancel of a fired order left ingredient stock deducted. It now reverses
--    them the same way (an 'adjustment' movement referenced `void:<line id>`,
--    skipped for any line already reversed), in the same transaction.
--
-- 2. Credit tabs. leave_bill_on_credit frees the table but leaves the bill
--    'open', indistinguishable from an unpaid one — so a manager could cancel
--    the order and erase the customer's debt. It now stamps bills.credit_left_at,
--    and cancel_order refuses a stamped bill that still has an amount on it.
--    (An empty credit bill owes nothing and can be cancelled.) Bills left on
--    credit before this change carry no stamp; they can't be told apart.
--
-- Same arities, so `create or replace` is safe; grants are re-issued anyway.
-- ============================================================================

alter table public.bills add column if not exists credit_left_at timestamptz;

create or replace function public.leave_bill_on_credit(_bill_id uuid)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _customer uuid;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _status not in ('open', 'partial') then
    raise exception 'bill is already %', _status using errcode = '22023';
  end if;

  select customer_id into _customer
  from public.orders where bill_id = _bill_id and customer_id is not null limit 1;
  if _customer is null then
    raise exception 'attach a customer before leaving this bill unpaid' using errcode = '23514';
  end if;

  update public.bills set credit_left_at = coalesce(credit_left_at, now()) where id = _bill_id;

  update public.restaurant_tables t
  set state = 'free', current_order_id = null
  from public.orders o
  where o.bill_id = _bill_id and o.tenant_id = _tenant and t.id = o.table_id;

  -- New: the kitchen is done here too. The order stays `billed`, so nothing
  -- else will ever sweep these.
  update public.kots k
     set status = 'served'
   where k.tenant_id = _tenant
     and k.status <> 'served'
     and exists (
       select 1 from public.orders o
        where o.id = k.order_id and o.bill_id = _bill_id
     );

  update public.kot_items ki
     set status = 'served'
   where ki.tenant_id = _tenant
     and ki.status <> 'served'
     and exists (
       select 1 from public.kots k
         join public.orders o on o.id = k.order_id
        where k.id = ki.kot_id and o.bill_id = _bill_id
     )
     and not exists (
       select 1 from public.order_items oi
        where oi.id = ki.order_item_id and oi.is_void
     );

  return _status;
end $$;

revoke execute on function public.leave_bill_on_credit(uuid) from anon, public;
grant execute on function public.leave_bill_on_credit(uuid) to authenticated;

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
