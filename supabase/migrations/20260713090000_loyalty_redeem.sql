-- ============================================================================
-- Pay-with-loyalty-points on the bill.
--   * points_value_cents on tenant_settings — configurable redemption rate
--     (default 1 → 1 point = 1 cent). Region-agnostic (rule #2).
--   * attach_bill_customer — dine-in orders carry no customer; let the cashier
--     attach one (match by phone or create) so points can be identified.
--   * redeem_points_for_bill — burn points + record a 'points' payment ATOMICALLY,
--     capped by both the account balance and the outstanding due, idempotent,
--     gated on payment.take (a cashier can redeem, unlike manager-only earn/burn).
-- ============================================================================

alter table public.tenant_settings
  add column if not exists points_value_cents integer not null default 1;

-- Attach (or create) a customer on the order behind a bill.
create or replace function public.attach_bill_customer(_bill_id uuid, _name text, _phone text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _cust uuid;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select id into _order from public.orders where bill_id = _bill_id and tenant_id = _tenant limit 1;
  if _order is null then raise exception 'no order for this bill' using errcode = 'P0002'; end if;

  _name := nullif(trim(_name), '');
  _phone := nullif(trim(_phone), '');
  if _name is null and _phone is null then
    raise exception 'name or phone required' using errcode = '22023';
  end if;

  if _phone is not null then
    select id into _cust from public.customers
    where tenant_id = _tenant and phone = _phone limit 1;
  end if;
  if _cust is null then
    insert into public.customers (tenant_id, name, phone)
    values (_tenant, coalesce(_name, 'Guest'), _phone) returning id into _cust;
  end if;

  update public.orders set customer_id = _cust where id = _order;
  return _cust;
end $$;

-- Burn points → record a 'points' payment, atomically and idempotently.
create or replace function public.redeem_points_for_bill(_bill_id uuid, _points integer, _idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _order uuid; _cust uuid; _rate integer; _total integer;
  _paid integer; _due integer; _acct uuid; _bal integer; _use integer; _value integer;
  _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _points <= 0 then raise exception 'points must be positive' using errcode = '22023'; end if;

  -- Idempotent replay: if this key already recorded a payment, don't burn again.
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

  select id, points_balance into _acct, _bal from public.loyalty_accounts
  where tenant_id = _tenant and customer_id = _cust;
  if _acct is null or coalesce(_bal, 0) <= 0 then
    raise exception 'no points to redeem' using errcode = '22023';
  end if;

  -- Cap by requested, by balance, and by whole points that fit the due.
  _use := least(_points, _bal, _due / _rate);
  if _use <= 0 then raise exception 'points value below the outstanding minimum' using errcode = '22023'; end if;
  _value := _use * _rate;

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

revoke execute on function public.attach_bill_customer(uuid, text, text) from anon, public;
revoke execute on function public.redeem_points_for_bill(uuid, integer, text) from anon, public;
grant execute on function public.attach_bill_customer(uuid, text, text) to authenticated;
grant execute on function public.redeem_points_for_bill(uuid, integer, text) to authenticated;
