-- ============================================================================
-- attach_bill_customer no longer clobbers a customer already on the order.
--
-- The original did an unconditional `update orders set customer_id` — harmless
-- while only billing set that column. But POS now sets customer_id at create
-- time (place_staff_order), so a cashier attaching-by-phone to redeem points
-- under a *different* number would silently reassign the order's customer.
--
-- New rule: attach only fills an empty slot. If the order already has a
-- customer, return that existing customer id and leave the row untouched —
-- callers that just want "who is this order's customer" still get an answer,
-- and nobody's order is reassigned behind their back. Reassignment, if ever
-- wanted, must be its own deliberate action.
--
-- Same signature → `create or replace`; grants persist (re-issued to be explicit).
-- ============================================================================

create or replace function public.attach_bill_customer(_bill_id uuid, _name text, _phone text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _cust uuid; _existing uuid;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select id, customer_id into _order, _existing
  from public.orders where bill_id = _bill_id and tenant_id = _tenant limit 1;
  if _order is null then raise exception 'no order for this bill' using errcode = 'P0002'; end if;

  -- Slot already filled (e.g. POS set it at order create): don't reassign.
  if _existing is not null then
    return _existing;
  end if;

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

revoke execute on function public.attach_bill_customer(uuid, text, text) from anon, public;
grant execute on function public.attach_bill_customer(uuid, text, text) to authenticated;
