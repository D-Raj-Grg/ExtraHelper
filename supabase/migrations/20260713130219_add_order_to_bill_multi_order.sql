-- Wave G: attach another order to an existing bill (multi-order / merged tab).
-- recompute_bill already aggregates every order where orders.bill_id = _bill_id,
-- so we only need to point the order at the bill and recompute.
create or replace function public.add_order_to_bill(_bill_id uuid, _order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _tenant uuid; _btenant uuid; _obill uuid; _ostatus public.order_status; _table uuid;
begin
  select tenant_id into _btenant from public.bills where id = _bill_id;
  if _btenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  select tenant_id, bill_id, status, table_id into _tenant, _obill, _ostatus, _table
    from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if _tenant <> _btenant then raise exception 'bill and order belong to different tenants' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if _obill is not null and _obill <> _bill_id then
    raise exception 'order already belongs to another bill' using errcode = '22023';
  end if;
  if _ostatus in ('draft','cancelled') then
    raise exception 'order must be fired before billing' using errcode = '22023';
  end if;

  update public.orders set bill_id = _bill_id, status = 'billed' where id = _order_id;
  if _table is not null then
    update public.restaurant_tables set state = 'bill_requested' where id = _table and tenant_id = _tenant;
  end if;
  perform public.recompute_bill(_bill_id);
  return _bill_id;
end $function$;

grant execute on function public.add_order_to_bill(uuid, uuid) to authenticated;
