-- Wave K: customer-facing pay (QR pay-at-table + online prepay) via sandbox
-- gateway. An internal bill builder (no auth) is shared by the staff
-- create_bill_for_order (membership-checked) and the public pay RPC
-- (token/order-scoped, only ever CREDITS a bill, overpay-clamped).

-- Internal: build/return the bill for an order. NO auth check — callers must
-- authorize first. Mirrors create_bill_for_order's computation exactly.
create or replace function public._build_bill_for_order(_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _branch uuid; _table uuid; _otype public.order_type;
  _existing uuid; _status public.order_status; _bill uuid;
  _subtotal integer := 0; _service_pct numeric := 0; _packaging numeric := 0;
  _tax_rules jsonb := '[]'; _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0;
begin
  select tenant_id, branch_id, table_id, order_type, bill_id, status
    into _tenant, _branch, _table, _otype, _existing, _status
  from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if _existing is not null then return _existing; end if;
  if _status in ('draft','cancelled') then
    raise exception 'order must be fired before billing' using errcode = '22023';
  end if;

  select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
  from public.order_items where order_id = _order_id and is_void = false;
  select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;
  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then _packaging_cents := round(coalesce(_packaging, 0) * 100); end if;
  select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r where coalesce((r->>'inclusive')::boolean, false) = false;

  insert into public.bills (tenant_id, branch_id, table_id, status, subtotal_cents, tax_cents,
                            service_charge_cents, discount_cents, total_cents)
  values (_tenant, _branch, _table, 'open', _subtotal, _tax_cents, _service_cents + _packaging_cents,
          0, _subtotal + _service_cents + _packaging_cents + _tax_cents)
  returning id into _bill;
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description, qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents, 0, oi.unit_price_cents * oi.qty
  from public.order_items oi where oi.order_id = _order_id and oi.is_void = false;
  update public.orders set status = 'billed', bill_id = _bill where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table;
  end if;
  return _bill;
end $function$;

-- Staff path: authorize by membership, then delegate to the shared builder.
create or replace function public.create_bill_for_order(_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  return public._build_bill_for_order(_order_id);
end $function$;

-- Public pay: settle an order's bill from a customer surface (QR / storefront).
-- Only ever credits the bill (overpay clamped) and closes it when fully paid.
create or replace function public.public_pay_order(_order_id uuid, _reference text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _bill uuid; _total integer; _paid_before integer; _apply integer; _paid integer; _status public.bill_status;
begin
  if coalesce(trim(_reference), '') = '' then raise exception 'missing reference' using errcode = '22023'; end if;
  select tenant_id into _tenant from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;

  _bill := public._build_bill_for_order(_order_id);
  select total_cents into _total from public.bills where id = _bill;
  select coalesce(sum(amount_cents), 0) into _paid_before
    from public.payments where bill_id = _bill and status = 'completed'
      and idempotency_key is distinct from _reference;
  _apply := least(greatest(0, _total - _paid_before), _total);

  if _apply > 0 then
    insert into public.payments (tenant_id, bill_id, method, amount_cents, status, reference, idempotency_key)
    values (_tenant, _bill, 'online', _apply, 'completed', _reference, _reference)
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;

  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill and status = 'completed';
  _status := case when _paid >= _total then 'paid' when _paid > 0 then 'partial' else 'open' end;
  update public.bills set status = _status where id = _bill;
  if _status = 'paid' then
    update public.orders set status = 'closed' where bill_id = _bill;
    update public.restaurant_tables t set state = 'free' from public.bills b where b.id = _bill and t.id = b.table_id;
  end if;

  return jsonb_build_object('bill_id', _bill, 'status', _status, 'total', _total, 'paid', _paid);
end $function$;

grant execute on function public.public_pay_order(uuid, text) to anon, authenticated;
revoke execute on function public._build_bill_for_order(uuid) from anon;
