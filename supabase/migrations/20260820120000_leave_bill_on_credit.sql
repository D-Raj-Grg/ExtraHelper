-- ============================================================================
-- Leave a bill on a customer's tab — the "Unpaid (credit)" checkout.
--
-- That button used to be client-only: a toast and a router.push, with nothing
-- written anywhere. The bill stayed `open`, the order stayed `billed`, and the
-- *table stayed occupied* — the guest had gone, but the floor said otherwise
-- and no one could seat it again. Live tenants ended up with tables parked on
-- `bill_requested` for days (Table C3, 2026-08-19).
--
-- What a credit checkout actually means: the money is still owed, but the
-- guest has left. So the bill keeps its status (`open`/`partial` — nothing was
-- collected, and inventing a `paid` here would fabricate takings), and the
-- table goes back to `free`. The debt stays findable on the Completed tab,
-- where billed-and-unpaid orders now live regardless of the day.
--
-- Every table on the bill is released, not just one: add_order_to_bill merges
-- several orders onto one bill, and settling it frees all of them.
-- ============================================================================

create or replace function public.leave_bill_on_credit(_bill_id uuid)
returns public.bill_status language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _customer uuid;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  -- Same key the till's other money actions check: leaving a bill unsettled is
  -- a cashier decision, not a waiter one.
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- A settled or voided bill has nothing to put on a tab.
  if _status not in ('open', 'partial') then
    raise exception 'bill is already %', _status using errcode = '22023';
  end if;

  -- An unpaid bill with nobody's name on it is an unrecoverable debt. The
  -- checkout screen refuses it too; this is the half that can't be bypassed.
  select customer_id into _customer
  from public.orders where bill_id = _bill_id and customer_id is not null limit 1;
  if _customer is null then
    raise exception 'attach a customer before leaving this bill unpaid' using errcode = '23514';
  end if;

  update public.restaurant_tables t
  set state = 'free', current_order_id = null
  from public.orders o
  where o.bill_id = _bill_id and o.tenant_id = _tenant and t.id = o.table_id;

  return _status;
end $$;

revoke execute on function public.leave_bill_on_credit(uuid) from anon, public;
grant execute on function public.leave_bill_on_credit(uuid) to authenticated;
