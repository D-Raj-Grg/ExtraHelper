-- ============================================================================
-- Attach an *existing* customer to a bill by id.
--
-- attach_bill_customer(_name, _phone) can only find someone again by phone: a
-- guest saved with a name and no number is unreachable, and a second attach
-- would mint a duplicate "Guest" row. The tills now show a picker over the
-- tenant's customers, and a picked row carries an id — so take the id.
--
-- Same rules as attach_bill_customer: tenant membership, `payment.take`, and
-- fill-an-empty-slot only. Reassigning an order's customer stays a deliberate
-- action nobody has asked for yet.
-- ============================================================================

create or replace function public.attach_bill_customer_by_id(_bill_id uuid, _customer_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _existing uuid;
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

  -- Slot already filled: don't reassign, just answer who it is.
  if _existing is not null then
    return _existing;
  end if;

  -- The id came from the client, so it is checked against this tenant here —
  -- security definer would otherwise happily attach another tenant's guest.
  if not exists (
    select 1 from public.customers where id = _customer_id and tenant_id = _tenant
  ) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  update public.orders set customer_id = _customer_id where id = _order;
  return _customer_id;
end $$;

revoke execute on function public.attach_bill_customer_by_id(uuid, uuid) from anon, public;
grant execute on function public.attach_bill_customer_by_id(uuid, uuid) to authenticated;
