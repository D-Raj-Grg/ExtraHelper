-- ============================================================================
-- Void (order item) + refund (payment). Both manager-gated + audited (rule #5).
-- Voiding a line on an unpaid bill triggers a trusted recompute.
-- ============================================================================

-- Internal: recompute a bill from its orders' non-void items (same formula as
-- create_bill_for_order). NOT callable by clients — only via the owner-run
-- SECURITY DEFINER functions below.
create or replace function public.recompute_bill(_bill_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  _tenant uuid;
  _otype  public.order_type;
  _subtotal integer := 0;
  _service_pct numeric := 0;
  _packaging numeric := 0;
  _tax_rules jsonb := '[]';
  _service_cents integer := 0;
  _packaging_cents integer := 0;
  _tax_cents integer := 0;
  _discount integer := 0;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then return; end if;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0) into _subtotal
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;

  select order_type into _otype from public.orders where bill_id = _bill_id limit 1;
  select service_charge, packaging_fee, tax_rules
    into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;

  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then
    _packaging_cents := round(coalesce(_packaging, 0) * 100);
  end if;
  select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0)
    into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r
  where coalesce((r->>'inclusive')::boolean, false) = false;

  select coalesce(sum(case when d.type = 'percent'
                           then round(_subtotal * d.value / 100.0)
                           else round(d.value * 100) end), 0)
    into _discount
  from public.discounts d where d.bill_id = _bill_id;
  _discount := least(_discount, _subtotal + _service_cents + _packaging_cents + _tax_cents);

  update public.bills
  set subtotal_cents = _subtotal,
      service_charge_cents = _service_cents + _packaging_cents,
      tax_cents = _tax_cents,
      discount_cents = _discount,
      total_cents = _subtotal + _service_cents + _packaging_cents + _tax_cents - _discount
  where id = _bill_id;

  -- Refresh snapshot lines from the current non-void items.
  delete from public.bill_items where bill_id = _bill_id;
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description, qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill_id, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents, 0, oi.unit_price_cents * oi.qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;
end $$;

revoke execute on function public.recompute_bill(uuid) from anon, authenticated, public;

-- Void an order item (KOT amendment / bill void). Manager-gated + audited.
create or replace function public.void_order_item(_order_item_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _order  uuid;
  _bill   uuid;
  _bill_status public.bill_status;
begin
  select tenant_id, order_id into _tenant, _order
  from public.order_items where id = _order_item_id;
  if _tenant is null then
    raise exception 'order item not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'voids require a manager' using errcode = '42501';
  end if;
  if coalesce(trim(_reason), '') = '' then
    raise exception 'void reason is required' using errcode = '22023';
  end if;

  update public.order_items
  set is_void = true, void_reason = _reason
  where id = _order_item_id and is_void = false;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'void', 'order_item', _order_item_id,
          jsonb_build_object('reason', _reason));

  select bill_id into _bill from public.orders where id = _order;
  if _bill is not null then
    select status into _bill_status from public.bills where id = _bill;
    if _bill_status <> 'paid' then
      perform public.recompute_bill(_bill);
    end if;
  end if;
end $$;

revoke execute on function public.void_order_item(uuid, text) from anon, public;
grant execute on function public.void_order_item(uuid, text) to authenticated;

-- Refund against a bill's payments. Manager-gated + audited.
create or replace function public.refund_payment(_bill_id uuid, _amount_cents integer, _reason text)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _total  integer;
  _paid   integer;
  _refunded integer;
  _net    integer;
  _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'refunds require a manager' using errcode = '42501';
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

  insert into public.refunds (tenant_id, bill_id, amount_cents, reason, approved_by)
  values (_tenant, _bill_id, _amount_cents, _reason, auth.uid());

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'refund', 'bill', _bill_id,
          jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason));

  _net := _paid - (_refunded + _amount_cents);
  _status := case when _net <= 0 then 'void'
                  when _net < _total then 'partial'
                  else 'paid' end;
  update public.bills set status = _status where id = _bill_id;
  return _status;
end $$;

revoke execute on function public.refund_payment(uuid, integer, text) from anon, public;
grant execute on function public.refund_payment(uuid, integer, text) to authenticated;
