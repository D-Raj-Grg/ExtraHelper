-- ============================================================================
-- Concurrency hardening for the loyalty-redeem + coupon paths (adversarial
-- review of a4ee066 / 90b260c):
--   * redeem_points_for_bill: lock the bill + loyalty row (FOR UPDATE) and clamp
--     the points payment to the outstanding due — two concurrent redeems can no
--     longer double-burn or overpay.
--   * attach_bill_customer: never silently overwrite an existing customer.
--   * apply_coupon: atomic used_count increment enforcing max_uses; reject >100%.
-- ============================================================================

create or replace function public.redeem_points_for_bill(_bill_id uuid, _points integer, _idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _order uuid; _cust uuid; _rate integer; _total integer;
  _paid integer; _due integer; _acct uuid; _bal integer; _use integer; _value integer;
  _status public.bill_status;
begin
  -- Serialize all money ops on this bill.
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id for update;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _points <= 0 then raise exception 'points must be positive' using errcode = '22023'; end if;

  if _idempotency_key is not null and exists (
    select 1 from public.payments where tenant_id = _tenant and idempotency_key = _idempotency_key
  ) then
    select status into _status from public.bills where id = _bill_id;
    return jsonb_build_object('burned', 0, 'value_cents', 0, 'status', _status, 'replayed', true);
  end if;

  select id, customer_id into _order, _cust from public.orders
  where bill_id = _bill_id and tenant_id = _tenant limit 1;
  if _cust is null then raise exception 'no customer attached to this bill' using errcode = '22023'; end if;

  select greatest(1, coalesce(points_value_cents, 1)) into _rate
  from public.tenant_settings where tenant_id = _tenant;
  _rate := coalesce(_rate, 1);

  select coalesce(sum(amount_cents), 0) into _paid from public.payments
  where bill_id = _bill_id and status = 'completed';
  _due := greatest(0, _total - _paid);
  if _due = 0 then raise exception 'bill already settled' using errcode = '22023'; end if;

  -- Lock the loyalty row so a concurrent redeem can't lose the balance update.
  select id, points_balance into _acct, _bal from public.loyalty_accounts
  where tenant_id = _tenant and customer_id = _cust for update;
  if _acct is null or coalesce(_bal, 0) <= 0 then
    raise exception 'no points to redeem' using errcode = '22023';
  end if;

  _use := least(_points, _bal, _due / _rate);
  if _use <= 0 then raise exception 'points value below the outstanding minimum' using errcode = '22023'; end if;
  -- Clamp the applied money to the outstanding due (defense in depth).
  _value := least(_use * _rate, _due);

  update public.loyalty_accounts
  set points_balance = _bal - _use,
      tier = case when _bal - _use >= 500 then 'gold'
                  when _bal - _use >= 100 then 'silver' else 'bronze' end
  where id = _acct;

  insert into public.loyalty_transactions (tenant_id, loyalty_account_id, type, points, reference)
  values (_tenant, _acct, 'burn', _use, 'redeem:' || _bill_id::text);

  insert into public.payments (tenant_id, bill_id, method, amount_cents, status, idempotency_key)
  values (_tenant, _bill_id, 'points', _value, 'completed', _idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;

  select coalesce(sum(amount_cents), 0) into _paid from public.payments
  where bill_id = _bill_id and status = 'completed';
  _status := case when _paid >= _total then 'paid' when _paid > 0 then 'partial' else 'open' end;
  update public.bills set status = _status where id = _bill_id;
  if _status = 'paid' then
    update public.orders set status = 'closed' where bill_id = _bill_id;
    update public.restaurant_tables t set state = 'free' from public.bills b where b.id = _bill_id and t.id = b.table_id;
  end if;

  return jsonb_build_object('burned', _use, 'value_cents', _value, 'balance', _bal - _use, 'status', _status);
end $$;

create or replace function public.attach_bill_customer(_bill_id uuid, _name text, _phone text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _existing uuid; _cust uuid;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select id, customer_id into _order, _existing from public.orders
  where bill_id = _bill_id and tenant_id = _tenant limit 1;
  if _order is null then raise exception 'no order for this bill' using errcode = 'P0002'; end if;
  if _existing is not null then
    raise exception 'this order already has a customer attached' using errcode = '22023';
  end if;

  _name := nullif(trim(_name), '');
  _phone := nullif(trim(_phone), '');
  if _name is null and _phone is null then
    raise exception 'name or phone required' using errcode = '22023';
  end if;

  if _phone is not null then
    select id into _cust from public.customers where tenant_id = _tenant and phone = _phone limit 1;
  end if;
  if _cust is null then
    insert into public.customers (tenant_id, name, phone)
    values (_tenant, coalesce(_name, 'Guest'), _phone) returning id into _cust;
  end if;

  update public.orders set customer_id = _cust where id = _order and customer_id is null;
  return _cust;
end $$;

create or replace function public.apply_coupon(_bill_id uuid, _code text)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _subtotal integer; _service integer; _tax integer; _discount integer;
        _c public.coupons; _norm text; _bumped integer;
begin
  select tenant_id, subtotal_cents, service_charge_cents, tax_cents into _tenant, _subtotal, _service, _tax
  from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;

  _norm := upper(trim(coalesce(_code, '')));
  if _norm = '' then raise exception 'enter a coupon code' using errcode = '22023'; end if;

  select * into _c from public.coupons where tenant_id = _tenant and upper(code) = _norm limit 1;
  if _c.id is null then raise exception 'invalid coupon' using errcode = '22023'; end if;
  if not _c.active then raise exception 'coupon is inactive' using errcode = '22023'; end if;
  if _c.expires_at is not null and _c.expires_at < now() then raise exception 'coupon has expired' using errcode = '22023'; end if;
  if _c.type = 'percent' and _c.value > 100 then raise exception 'coupon percent cannot exceed 100' using errcode = '22023'; end if;
  if exists (select 1 from public.discounts where bill_id = _bill_id and upper(coupon_code) = _norm) then
    raise exception 'coupon already applied to this bill' using errcode = '22023';
  end if;

  -- Atomic usage-cap enforcement: only bump if still under max_uses.
  update public.coupons set used_count = used_count + 1
  where id = _c.id and (max_uses is null or used_count < max_uses);
  get diagnostics _bumped = row_count;
  if _bumped = 0 then raise exception 'coupon usage limit reached' using errcode = '22023'; end if;

  insert into public.discounts (tenant_id, bill_id, type, value, coupon_code, reason, approved_by)
  values (_tenant, _bill_id, _c.type, _c.value, _c.code, 'coupon', auth.uid());

  _discount := least(public.bill_discount_total(_bill_id, _subtotal), _subtotal + _service + _tax);
  update public.bills
  set discount_cents = _discount, total_cents = _subtotal + _service + _tax - _discount
  where id = _bill_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('coupon', _c.code, 'type', _c.type, 'value', _c.value));
  return _subtotal + _service + _tax - _discount;
end $$;
