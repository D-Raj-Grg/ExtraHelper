-- Enforce granular permissions at the RPC layer (defense against a direct API
-- call by an owner/manager-based custom role that has the permission denied).
-- Bodies unchanged except the added has_permission gate after the role check.

create or replace function public.void_order_item(_order_item_id uuid, _reason text)
returns void language plpgsql security definer set search_path = 'public'
as $function$
declare
  _tenant uuid; _order uuid; _item uuid; _qty integer; _wasvoid boolean;
  _bill uuid; _bill_status public.bill_status;
begin
  select tenant_id, order_id, item_id, qty, is_void
    into _tenant, _order, _item, _qty, _wasvoid
  from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'voids require a manager' using errcode = '42501'; end if;
  if not public.has_permission(_tenant, 'order.void') then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'void reason is required' using errcode = '22023'; end if;
  if _wasvoid then return; end if;

  update public.order_items set is_void = true, void_reason = _reason where id = _order_item_id and is_void = false;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'void', 'order_item', _order_item_id, jsonb_build_object('reason', _reason));

  if _item is not null
     and exists (select 1 from public.stock_movements where tenant_id = _tenant and type = 'sale' and reference = _order_item_id::text)
     and not exists (select 1 from public.stock_movements where tenant_id = _tenant and reference = 'void:' || _order_item_id::text) then
    update public.inventory_items i set current_qty = i.current_qty + (r.qty * _qty)
    from public.recipes r where r.menu_item_id = _item and r.tenant_id = _tenant and i.id = r.inventory_item_id;
    insert into public.stock_movements (tenant_id, branch_id, inventory_item_id, type, qty, reference)
    select _tenant, (select branch_id from public.orders where id = _order), r.inventory_item_id, 'adjustment', (r.qty * _qty), 'void:' || _order_item_id::text
    from public.recipes r where r.menu_item_id = _item and r.tenant_id = _tenant;
  end if;

  select bill_id into _bill from public.orders where id = _order;
  if _bill is not null then
    select status into _bill_status from public.bills where id = _bill;
    if _bill_status <> 'paid' then perform public.recompute_bill(_bill); end if;
  end if;
end $function$;

create or replace function public.apply_bill_discount(_bill_id uuid, _type public.discount_type, _value numeric, _reason text default null)
returns integer language plpgsql security definer set search_path = 'public'
as $function$
declare _tenant uuid; _subtotal integer; _service integer; _tax integer; _discount integer := 0;
begin
  select tenant_id, subtotal_cents, service_charge_cents, tax_cents into _tenant, _subtotal, _service, _tax
  from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'discounts require a manager' using errcode = '42501'; end if;
  if not public.has_permission(_tenant, 'order.discount') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then raise exception 'percent discount cannot exceed 100' using errcode = '22023'; end if;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, _type, _value, _reason, auth.uid());

  select coalesce(sum(case when d.type = 'percent' then round(_subtotal * d.value / 100.0) else round(d.value * 100) end), 0)
    into _discount from public.discounts d where d.bill_id = _bill_id and d.bill_id is not null;
  _discount := least(_discount, _subtotal + _service + _tax);

  update public.bills set discount_cents = _discount, total_cents = _subtotal + _service + _tax - _discount where id = _bill_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id, jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  return _subtotal + _service + _tax - _discount;
end $function$;

create or replace function public.refund_payment(_bill_id uuid, _amount_cents integer, _reason text)
returns public.bill_status language plpgsql security definer set search_path = 'public'
as $function$
declare _tenant uuid; _total integer; _paid integer; _refunded integer; _net integer; _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then raise exception 'refunds require a manager' using errcode = '42501'; end if;
  if not public.has_permission(_tenant, 'payment.refund') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'refund must be positive' using errcode = '22023'; end if;

  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill_id and status = 'completed';
  select coalesce(sum(amount_cents), 0) into _refunded from public.refunds where bill_id = _bill_id;
  if _amount_cents > _paid - _refunded then raise exception 'refund exceeds net paid' using errcode = '22023'; end if;

  insert into public.refunds (tenant_id, bill_id, amount_cents, reason, approved_by)
  values (_tenant, _bill_id, _amount_cents, _reason, auth.uid());
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'refund', 'bill', _bill_id, jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason));

  _net := _paid - (_refunded + _amount_cents);
  _status := case when _net <= 0 then 'void' when _net < _total then 'partial' else 'paid' end;
  update public.bills set status = _status where id = _bill_id;
  return _status;
end $function$;

create or replace function public.record_payment(_bill_id uuid, _method public.payment_method, _amount_cents integer, _idempotency_key text default null)
returns public.bill_status language plpgsql security definer set search_path = 'public'
as $function$
declare _tenant uuid; _total integer; _paid integer; _status public.bill_status;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then raise exception 'permission denied' using errcode = '42501'; end if;
  if _amount_cents <= 0 then raise exception 'payment must be positive' using errcode = '22023'; end if;

  insert into public.payments (tenant_id, bill_id, method, amount_cents, status, idempotency_key)
  values (_tenant, _bill_id, _method, _amount_cents, 'completed', _idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing;

  select coalesce(sum(amount_cents), 0) into _paid from public.payments where bill_id = _bill_id and status = 'completed';
  _status := case when _paid >= _total then 'paid' when _paid > 0 then 'partial' else 'open' end;
  update public.bills set status = _status where id = _bill_id;

  if _status = 'paid' then
    update public.orders set status = 'closed' where bill_id = _bill_id;
    update public.restaurant_tables t set state = 'free' from public.bills b where b.id = _bill_id and t.id = b.table_id;
  end if;

  return _status;
end $function$;
