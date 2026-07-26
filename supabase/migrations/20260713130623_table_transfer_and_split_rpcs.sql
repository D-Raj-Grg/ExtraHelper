-- Wave F: move an order between tables (transfer) and split selected items to a
-- new order on another table (split). Merge is composed in the app from
-- create_bill_for_order + add_order_to_bill.

-- Helper: free a table if it has no remaining active (non-closed/cancelled) order.
create or replace function public.refresh_table_state(_table uuid, _tenant uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _active uuid;
begin
  if _table is null then return; end if;
  select id into _active from public.orders
   where tenant_id = _tenant and table_id = _table
     and status not in ('closed','cancelled')
   order by created_at desc limit 1;
  if _active is null then
    update public.restaurant_tables set state = 'free', current_order_id = null
     where id = _table and tenant_id = _tenant;
  else
    update public.restaurant_tables set current_order_id = _active
     where id = _table and tenant_id = _tenant;
  end if;
end $function$;

create or replace function public.transfer_order(_order_id uuid, _to_table uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _from uuid; _ttenant uuid;
begin
  select tenant_id, table_id into _tenant, _from from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner','manager','receptionist','waiter','cashier') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select tenant_id into _ttenant from public.restaurant_tables where id = _to_table;
  if _ttenant is null or _ttenant <> _tenant then
    raise exception 'destination table not found' using errcode = 'P0002';
  end if;
  if _from = _to_table then return; end if;

  update public.orders set table_id = _to_table where id = _order_id;
  update public.restaurant_tables set state = 'occupied', current_order_id = _order_id
    where id = _to_table and tenant_id = _tenant;
  perform public.refresh_table_state(_from, _tenant);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'table_transfer', 'order', _order_id,
          jsonb_build_object('from_table', _from, 'to_table', _to_table));
end $function$;

create or replace function public.split_order_items(_order_id uuid, _to_table uuid, _item_ids uuid[])
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _tenant uuid; _branch uuid; _otype public.order_type; _new uuid; _moved integer;
begin
  select tenant_id, branch_id, order_type into _tenant, _branch, _otype
    from public.orders where id = _order_id;
  if _tenant is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner','manager','receptionist','waiter','cashier') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _item_ids is null or array_length(_item_ids, 1) is null then
    raise exception 'no items selected' using errcode = '22023';
  end if;
  if _to_table is not null then
    if not exists (select 1 from public.restaurant_tables where id = _to_table and tenant_id = _tenant) then
      raise exception 'destination table not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.orders (tenant_id, branch_id, table_id, order_type, status)
  values (_tenant, _branch, _to_table, coalesce(_otype, 'dine_in'), 'in_kitchen')
  returning id into _new;

  update public.order_items
     set order_id = _new
   where tenant_id = _tenant and order_id = _order_id and id = any(_item_ids);
  get diagnostics _moved = row_count;
  if _moved = 0 then
    delete from public.orders where id = _new;
    raise exception 'no matching items to split' using errcode = '22023';
  end if;

  if _to_table is not null then
    update public.restaurant_tables set state = 'occupied', current_order_id = _new
      where id = _to_table and tenant_id = _tenant;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'table_split', 'order', _order_id,
          jsonb_build_object('new_order', _new, 'to_table', _to_table, 'items', to_jsonb(_item_ids)));
  return _new;
end $function$;

grant execute on function public.refresh_table_state(uuid, uuid) to authenticated;
grant execute on function public.transfer_order(uuid, uuid) to authenticated;
grant execute on function public.split_order_items(uuid, uuid, uuid[]) to authenticated;
