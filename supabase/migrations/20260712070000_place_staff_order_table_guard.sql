-- Harden place_staff_order: reject a table_id that doesn't belong to the tenant
-- (SECURITY DEFINER bypasses RLS, so validate explicitly) and scope the occupy
-- update by tenant_id so it can never flip another tenant's table.
create or replace function public.place_staff_order(
  _tenant uuid,
  _idempotency_key text,
  _table_id uuid,
  _order_type public.order_type,
  _items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _branch uuid;
  _order  uuid;
  _line   jsonb;
  _item   record;
  _count  integer := 0;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if coalesce(trim(_idempotency_key), '') = '' then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if _items is null or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode = '22023';
  end if;

  if _table_id is not null then
    select branch_id into _branch from public.restaurant_tables
    where id = _table_id and tenant_id = _tenant;
    if not found then
      raise exception 'table does not belong to this tenant' using errcode = '22023';
    end if;
  end if;

  insert into public.orders (tenant_id, branch_id, table_id, order_type, status, idempotency_key)
  values (_tenant, _branch, _table_id, _order_type, 'draft', _idempotency_key)
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into _order;

  if _order is null then
    select id into _order from public.orders
    where tenant_id = _tenant and idempotency_key = _idempotency_key;
    return _order;
  end if;

  for _line in select * from jsonb_array_elements(_items)
  loop
    select id, name, base_price_cents into _item
    from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant
      and is_active and not is_86;
    if _item.id is not null then
      insert into public.order_items (tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _item.name,
              greatest(1, coalesce((_line->>'qty')::int, 1)), _item.base_price_cents, 'draft');
      _count := _count + 1;
    end if;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
  end if;

  if _table_id is not null then
    update public.restaurant_tables set state = 'occupied'
    where id = _table_id and tenant_id = _tenant and state = 'free';
  end if;

  return _order;
end $$;

revoke execute on function public.place_staff_order(uuid, text, uuid, public.order_type, jsonb) from anon, public;
grant execute on function public.place_staff_order(uuid, text, uuid, public.order_type, jsonb) to authenticated;
