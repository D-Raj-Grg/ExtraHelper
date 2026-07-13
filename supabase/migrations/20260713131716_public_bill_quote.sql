-- Wave K: quote an order's outstanding amount for a customer surface, so the
-- gateway can be charged the right amount before public_pay_order records it.
create or replace function public.public_bill_quote(_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _bill uuid; _total integer; _paid integer; _currency text; _gateway text;
begin
  select tenant_id into _tenant from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  _bill := public._build_bill_for_order(_order_id);
  select total_cents into _total from public.bills where id = _bill;
  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill and status = 'completed';
  select currency, payment_gateway into _currency, _gateway from public.tenant_settings where tenant_id = _tenant;
  return jsonb_build_object(
    'bill_id', _bill, 'total', _total, 'paid', _paid, 'due', greatest(0, _total - _paid),
    'currency', coalesce(_currency, 'USD'), 'gateway', coalesce(_gateway, 'sandbox'), 'tenant_id', _tenant
  );
end $function$;

grant execute on function public.public_bill_quote(uuid) to anon, authenticated;
