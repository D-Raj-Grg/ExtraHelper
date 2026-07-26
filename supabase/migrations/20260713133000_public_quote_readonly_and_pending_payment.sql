-- Review fixes:
-- (#3) public_bill_quote must be READ-ONLY — quoting an order should not build
--      its bill (which transitioned order->billed, table->bill_requested).
-- (#2) add public_record_pending so a gateway 'pending' result persists a
--      pending payment row the webhook can later reconcile to completed.

-- Read-only quote: reuse an existing bill's totals, else compute what the bill
-- WOULD be from order_items + settings, without inserting anything.
create or replace function public.public_bill_quote(_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _bill uuid; _otype public.order_type; _status public.order_status;
  _total integer; _paid integer := 0; _currency text; _gateway text;
  _subtotal integer := 0; _service_pct numeric := 0; _packaging numeric := 0;
  _tax_rules jsonb := '[]'; _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0;
begin
  select tenant_id, bill_id, order_type, status into _tenant, _bill, _otype, _status
  from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  select currency, payment_gateway into _currency, _gateway from public.tenant_settings where tenant_id = _tenant;

  if _bill is not null then
    select total_cents into _total from public.bills where id = _bill;
    select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill and status = 'completed';
  else
    if _status in ('draft','cancelled') then
      _total := 0;
    else
      select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
      from public.order_items where order_id = _order_id and is_void = false;
      select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
      from public.tenant_settings where tenant_id = _tenant;
      _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
      if _otype in ('pickup', 'delivery') then _packaging_cents := round(coalesce(_packaging, 0) * 100); end if;
      select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
      from jsonb_array_elements(coalesce(_tax_rules, '[]')) r where coalesce((r->>'inclusive')::boolean, false) = false;
      _total := _subtotal + _service_cents + _packaging_cents + _tax_cents;
    end if;
  end if;

  return jsonb_build_object(
    'bill_id', _bill, 'total', _total, 'paid', _paid, 'due', greatest(0, _total - _paid),
    'currency', coalesce(_currency, 'USD'), 'gateway', coalesce(_gateway, 'sandbox'), 'tenant_id', _tenant
  );
end $function$;

-- Persist a pending payment (gateway processing) so the webhook can reconcile it.
create or replace function public.public_record_pending(_order_id uuid, _reference text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _bill uuid; _total integer; _paid integer; _due integer;
begin
  if coalesce(trim(_reference), '') = '' then raise exception 'missing reference' using errcode = '22023'; end if;
  select tenant_id into _tenant from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  _bill := public._build_bill_for_order(_order_id);
  select total_cents into _total from public.bills where id = _bill;
  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill and status = 'completed';
  _due := greatest(0, _total - _paid);
  if _due > 0 then
    insert into public.payments (tenant_id, bill_id, method, amount_cents, status, reference, idempotency_key)
    values (_tenant, _bill, 'online', _due, 'pending', _reference, _reference)
    on conflict (tenant_id, idempotency_key) do nothing;
  end if;
  return jsonb_build_object('bill_id', _bill, 'due', _due);
end $function$;

grant execute on function public.public_record_pending(uuid, text) to anon, authenticated;
