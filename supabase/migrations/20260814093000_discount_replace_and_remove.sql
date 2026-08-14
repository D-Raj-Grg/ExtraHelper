-- Discounts replace rather than stack, and can be taken back off.
--
-- Before this, every apply_* call inserted another `discounts` row and
-- bill_discount_total summed them all, so applying 10% and then 20% took 30%
-- off. A "staff bill discount" — the slot that a typed discount and a comp
-- share — is a row with no order_item_id and no coupon_code. Coupons are
-- deliberately outside that slot: a guest redeemed one, apply_coupon already
-- refuses the same code twice, and a manager typing a discount should not
-- silently void it (the coupon's used_count would stay incremented).

create or replace function public.apply_bill_discount(
  _bill_id uuid, _type public.discount_type, _value numeric, _reason text default null
) returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare _tenant uuid; _total integer; _status public.bill_status; _replaced integer;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;

  delete from public.discounts
  where bill_id = _bill_id and order_item_id is null and coupon_code is null;
  get diagnostics _replaced = row_count;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, _type, _value, _reason, auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason,
                             'replaced', _replaced));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $function$;

create or replace function public.set_bill_complimentary(_bill_id uuid, _reason text)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare _tenant uuid; _status public.bill_status; _gross integer; _total integer; _replaced integer;
begin
  select tenant_id, status, subtotal_cents + service_charge_cents + tax_cents
    into _tenant, _status, _gross
  from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status not in ('open', 'partial') then
    raise exception 'bill already settled' using errcode = '22023';
  end if;
  if trim(coalesce(_reason, '')) = '' then
    raise exception 'complimentary needs a reason' using errcode = '22023';
  end if;

  select _gross + coalesce(sum(amount_cents), 0) into _gross
  from public.bill_charges where bill_id = _bill_id;

  -- The comp takes the staff slot, so a discount typed earlier does not get
  -- added on top of a bill that is already fully on the house.
  delete from public.discounts
  where bill_id = _bill_id and order_item_id is null and coupon_code is null;
  get diagnostics _replaced = row_count;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, 'flat', _gross / 100.0, left(trim(_reason), 200), auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'complimentary', 'bill', _bill_id,
          jsonb_build_object('gross_cents', _gross, 'reason', trim(_reason),
                             'replaced', _replaced));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $function$;

create or replace function public.apply_item_discount(
  _order_item_id uuid, _type public.discount_type, _value numeric, _reason text default null
) returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare _tenant uuid; _order uuid; _bill uuid; _bill_status public.bill_status; _replaced integer;
begin
  select tenant_id, order_id into _tenant, _order from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;
  select bill_id into _bill from public.orders where id = _order;
  if _bill is null then raise exception 'item is not on a bill yet' using errcode = '22023'; end if;
  select status into _bill_status from public.bills where id = _bill;
  if _bill_status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;

  -- Only this line's discount is replaced; other lines keep theirs.
  delete from public.discounts where order_item_id = _order_item_id;
  get diagnostics _replaced = row_count;

  insert into public.discounts (tenant_id, bill_id, order_item_id, type, value, reason, approved_by)
  values (_tenant, _bill, _order_item_id, _type, _value, _reason, auth.uid());

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'order_item', _order_item_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason,
                             'replaced', _replaced));

  perform public.recompute_bill(_bill);
end $function$;

-- Take the staff discount back off a bill. Leaves any coupon in place.
create or replace function public.remove_bill_discount(_bill_id uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare _tenant uuid; _status public.bill_status; _total integer; _removed integer;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;

  delete from public.discounts
  where bill_id = _bill_id and order_item_id is null and coupon_code is null;
  get diagnostics _removed = row_count;

  perform public.recompute_bill(_bill_id);

  if _removed > 0 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'discount_removed', 'bill', _bill_id,
            jsonb_build_object('removed', _removed));
  end if;

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $function$;

-- Take the discount back off one line.
create or replace function public.remove_item_discount(_order_item_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare _tenant uuid; _order uuid; _bill uuid; _bill_status public.bill_status; _removed integer;
begin
  select tenant_id, order_id into _tenant, _order from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select bill_id into _bill from public.orders where id = _order;
  if _bill is null then raise exception 'item is not on a bill yet' using errcode = '22023'; end if;
  select status into _bill_status from public.bills where id = _bill;
  if _bill_status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;

  delete from public.discounts where order_item_id = _order_item_id;
  get diagnostics _removed = row_count;

  perform public.recompute_bill(_bill);

  if _removed > 0 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
    values (_tenant, auth.uid(), 'discount_removed', 'order_item', _order_item_id,
            jsonb_build_object('removed', _removed));
  end if;
end $function$;

-- PUBLIC holds EXECUTE by default, so revoking from anon alone does nothing.
revoke execute on function public.remove_bill_discount(uuid) from public;
revoke execute on function public.remove_item_discount(uuid) from public;
revoke execute on function public.remove_bill_discount(uuid) from anon;
revoke execute on function public.remove_item_discount(uuid) from anon;
grant execute on function public.remove_bill_discount(uuid) to authenticated;
grant execute on function public.remove_item_discount(uuid) to authenticated;
