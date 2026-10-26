-- Mobile floor/table admin + reservation lifecycle RPCs.
create or replace function public.create_floor(_tenant uuid, _name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid; _n text := nullif(btrim(_name), '');
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized to manage floors' using errcode = '42501';
  end if;
  if _n is null then raise exception 'floor name required' using errcode = '22023'; end if;
  insert into public.floors (tenant_id, name, sort)
  values (_tenant, _n, coalesce((select max(sort) + 1 from public.floors where tenant_id = _tenant), 0))
  returning id into _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'floor_create', 'floor', _id, jsonb_build_object('name', _n));
  return _id;
end $$;

create or replace function public.create_table(_tenant uuid, _label text, _capacity int, _floor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid; _l text := nullif(btrim(_label), '');
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized to manage tables' using errcode = '42501';
  end if;
  if _l is null then raise exception 'table label required' using errcode = '22023'; end if;
  if _capacity is null or _capacity < 1 or _capacity > 50 then
    raise exception 'capacity must be 1-50' using errcode = '22023';
  end if;
  if _floor_id is not null and not exists
     (select 1 from public.floors where id = _floor_id and tenant_id = _tenant) then
    raise exception 'floor not found' using errcode = 'P0002';
  end if;
  insert into public.restaurant_tables (tenant_id, floor_id, label, capacity)
  values (_tenant, _floor_id, _l, _capacity) returning id into _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'table_create', 'restaurant_table', _id,
          jsonb_build_object('label', _l, 'capacity', _capacity));
  return _id;
end $$;

create or replace function public.delete_table(_table_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _tenant uuid; _label text;
begin
  select tenant_id, label into _tenant, _label from public.restaurant_tables where id = _table_id;
  if _tenant is null then raise exception 'table not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized to manage tables' using errcode = '42501';
  end if;
  if exists (select 1 from public.orders where tenant_id = _tenant and table_id = _table_id
             and status not in ('closed', 'cancelled')) then
    raise exception 'table % still has an open order', _label using errcode = '22023';
  end if;
  delete from public.restaurant_tables where id = _table_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'table_delete', 'restaurant_table', _table_id,
          jsonb_build_object('label', _label));
end $$;

create or replace function public.create_reservation(
  _tenant uuid, _name text, _phone text, _party int, _when timestamptz, _table_id uuid, _notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid; _cust uuid;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'receptionist') then
    raise exception 'not authorized to manage reservations' using errcode = '42501';
  end if;
  if nullif(btrim(_name), '') is null then
    raise exception 'guest name required' using errcode = '22023';
  end if;
  if _party is null or _party < 1 or _party > 50 then
    raise exception 'party size must be 1-50' using errcode = '22023';
  end if;
  if _when is null then raise exception 'date and time required' using errcode = '22023'; end if;
  if _table_id is not null and not exists
     (select 1 from public.restaurant_tables where id = _table_id and tenant_id = _tenant) then
    raise exception 'table not found' using errcode = 'P0002';
  end if;
  _cust := public.customer_for_phone(_tenant, _name, _phone);
  insert into public.reservations (tenant_id, table_id, customer_id, party_size, reserved_at, status, notes)
  values (_tenant, _table_id, _cust, _party, _when, 'pending', nullif(btrim(_notes), ''))
  returning id into _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'reservation_create', 'reservation', _id,
          jsonb_build_object('party', _party, 'when', _when));
  return _id;
end $$;

create or replace function public.set_reservation_status(_id uuid, _status reservation_status)
returns void language plpgsql security definer set search_path = public as $$
declare _tenant uuid; _cur reservation_status; _table uuid; _tstate table_state;
begin
  select tenant_id, status, table_id into _tenant, _cur, _table
    from public.reservations where id = _id;
  if _tenant is null then raise exception 'reservation not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'receptionist') then
    raise exception 'not authorized to manage reservations' using errcode = '42501';
  end if;
  if not ((_cur = 'pending'   and _status in ('confirmed', 'cancelled'))
       or (_cur = 'confirmed' and _status in ('seated', 'no_show', 'cancelled'))) then
    raise exception 'cannot move reservation from % to %', _cur, _status using errcode = '22023';
  end if;
  if _status = 'seated' and _table is not null then
    select state into _tstate from public.restaurant_tables where id = _table;
    if _tstate in ('free', 'reserved') then
      update public.restaurant_tables set state = 'occupied' where id = _table;
    end if;
  end if;
  update public.reservations set status = _status where id = _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'reservation_status', 'reservation', _id,
          jsonb_build_object('from', _cur, 'to', _status));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_floor(uuid,text)', 'create_table(uuid,text,int,uuid)', 'delete_table(uuid)',
    'create_reservation(uuid,text,text,int,timestamptz,uuid,text)',
    'set_reservation_status(uuid,reservation_status)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
