-- Seating must only ever touch a table in the reservation's own tenant: a row inserted
-- directly through the API can carry another tenant's table_id.
do $$
declare def text; fixed text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'set_reservation_status';
  fixed := replace(def,
    'from public.restaurant_tables where id = _table;',
    'from public.restaurant_tables where id = _table and tenant_id = _tenant;');
  fixed := replace(fixed,
    'update public.restaurant_tables set state = ''occupied'' where id = _table;',
    'update public.restaurant_tables set state = ''occupied'' where id = _table and tenant_id = _tenant;');
  if fixed = def or fixed not like '%where id = _table and tenant_id = _tenant;%' then
    raise exception 'tenant scope patch did not apply';
  end if;
  execute fixed;
end $$;
