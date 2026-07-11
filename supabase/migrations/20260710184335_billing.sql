-- ============================================================================
-- Billing: trusted bill generation + payment recording.
-- Tax / service charge / packaging are computed HERE (SECURITY DEFINER SQL),
-- never on the client, and read from per-tenant settings (rule #2 — nothing
-- hardcoded). tenant_settings.tax_rules is a jsonb array of
-- {name, rate (percent), inclusive (bool)}.
-- ============================================================================

-- Generate (or return existing) bill for an order. Idempotent.
create or replace function public.create_bill_for_order(_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant       uuid;
  _branch       uuid;
  _table        uuid;
  _otype        public.order_type;
  _existing     uuid;
  _bill         uuid;
  _subtotal     integer := 0;
  _service_pct  numeric := 0;
  _packaging    numeric := 0;
  _tax_rules    jsonb := '[]';
  _service_cents   integer := 0;
  _packaging_cents integer := 0;
  _tax_cents       integer := 0;
begin
  select tenant_id, branch_id, table_id, order_type, bill_id
    into _tenant, _branch, _table, _otype, _existing
  from public.orders where id = _order_id;
  if _tenant is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _existing is not null then
    return _existing;
  end if;

  -- Line subtotal from non-void order items (trusted — prices snapshot at order).
  select coalesce(sum(unit_price_cents * qty), 0) into _subtotal
  from public.order_items
  where order_id = _order_id and is_void = false;

  select service_charge, packaging_fee, tax_rules
    into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;

  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  -- Packaging fee (currency units → cents) applies to pickup/delivery only.
  if _otype in ('pickup', 'delivery') then
    _packaging_cents := round(coalesce(_packaging, 0) * 100);
  end if;

  -- Exclusive taxes add to the total; inclusive taxes are already in prices.
  select coalesce(sum(
           round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)
         ), 0)
    into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r
  where coalesce((r->>'inclusive')::boolean, false) = false;

  insert into public.bills (tenant_id, branch_id, table_id, status,
                            subtotal_cents, tax_cents, service_charge_cents,
                            discount_cents, total_cents)
  values (_tenant, _branch, _table, 'open',
          _subtotal, _tax_cents, _service_cents + _packaging_cents,
          0, _subtotal + _service_cents + _packaging_cents + _tax_cents)
  returning id into _bill;

  -- Snapshot lines onto the bill.
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description,
                                 qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents,
         0, oi.unit_price_cents * oi.qty
  from public.order_items oi
  where oi.order_id = _order_id and oi.is_void = false;

  update public.orders set status = 'billed', bill_id = _bill where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table;
  end if;

  return _bill;
end $$;

-- Record a payment against a bill; flip bill status to partial/paid.
create or replace function public.record_payment(
  _bill_id uuid,
  _method  public.payment_method,
  _amount_cents integer,
  _idempotency_key text default null
)
returns public.bill_status
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _total  integer;
  _paid   integer;
  _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total
  from public.bills where id = _bill_id;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants
                 where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _amount_cents <= 0 then
    raise exception 'payment must be positive' using errcode = '22023';
  end if;

  insert into public.payments (tenant_id, bill_id, method, amount_cents, status, idempotency_key)
  values (_tenant, _bill_id, _method, _amount_cents, 'completed', _idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;

  select coalesce(sum(amount_cents), 0) into _paid
  from public.payments where bill_id = _bill_id and status = 'completed';

  _status := case when _paid >= _total then 'paid'
                  when _paid > 0 then 'partial'
                  else 'open' end;
  update public.bills set status = _status where id = _bill_id;

  -- Fully paid dine-in bill closes the order + frees the table.
  if _status = 'paid' then
    update public.orders set status = 'closed' where bill_id = _bill_id;
    update public.restaurant_tables t set state = 'free'
    from public.bills b where b.id = _bill_id and t.id = b.table_id;
  end if;

  return _status;
end $$;

revoke execute on function public.create_bill_for_order(uuid) from anon, public;
grant execute on function public.create_bill_for_order(uuid) to authenticated;
revoke execute on function public.record_payment(uuid, public.payment_method, integer, text) from anon, public;
grant execute on function public.record_payment(uuid, public.payment_method, integer, text) to authenticated;
