-- Manager ops: 86 a dish, set a table's state.
--
-- Both were plain column updates guarded only by a role check inside a
-- TypeScript server action. RLS on `menu_items` and `restaurant_tables` is
-- tenant-scoped only, so any member of the tenant could do either through the
-- API directly — the guard was in the client, which is not a guard.
--
-- These functions move the rule into Postgres so both clients share one
-- answer, and they audit what happened. The role sets below mirror what the
-- web actions allowed on 2026-07-27 exactly, so nothing regresses:
--
--   * 86       — owner, manager, kitchen. The kitchen is who *knows* the dish
--                ran out, which is why it is not gated on `menu.edit`
--                (owner/manager only). A cleaner long-term fix is a dedicated
--                `menu.86` key in the shared catalog; that is a catalog change,
--                not a mobile one.
--   * state    — owner, manager, receptionist, waiter, cashier. A waiter
--                seating a guest or marking a table for cleaning is ordinary.

create or replace function public.set_item_86(_item_id uuid, _is_86 boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _name text;
begin
  select tenant_id, name into _tenant, _name
    from public.menu_items where id = _item_id;
  if _tenant is null then
    raise exception 'item not found' using errcode = 'P0002';
  end if;

  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'kitchen') then
    raise exception 'not authorized to change stock' using errcode = '42501';
  end if;

  update public.menu_items set is_86 = _is_86 where id = _item_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _tenant, auth.uid(),
    case when _is_86 then 'item_86' else 'item_unset_86' end,
    'menu_item', _item_id,
    jsonb_build_object('name', _name, 'is_86', _is_86)
  );
end $$;

create or replace function public.set_table_state(_table_id uuid, _state public.table_state)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _tenant uuid; _label text; _active uuid;
begin
  select tenant_id, label into _tenant, _label
    from public.restaurant_tables where id = _table_id;
  if _tenant is null then
    raise exception 'table not found' using errcode = 'P0002';
  end if;

  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'receptionist', 'waiter', 'cashier') then
    raise exception 'not authorized to change table state' using errcode = '42501';
  end if;

  -- Freeing a table that still has a live order would hide that order from the
  -- board while the kitchen is still cooking it. Close or cancel it first.
  if _state = 'free' then
    select id into _active from public.orders
     where tenant_id = _tenant and table_id = _table_id
       and status not in ('closed', 'cancelled')
     limit 1;
    if _active is not null then
      raise exception 'table % still has an open order', _label using errcode = '22023';
    end if;
  end if;

  update public.restaurant_tables
     set state = _state,
         current_order_id = case when _state = 'free' then null else current_order_id end
   where id = _table_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _tenant, auth.uid(), 'table_state', 'restaurant_table', _table_id,
    jsonb_build_object('label', _label, 'state', _state)
  );
end $$;

-- `public` holds EXECUTE by default on a new function, and revoking from anon
-- alone does nothing. Name the full signature.
revoke execute on function public.set_item_86(uuid, boolean) from public, anon;
revoke execute on function public.set_table_state(uuid, public.table_state) from public, anon;
grant execute on function public.set_item_86(uuid, boolean) to authenticated;
grant execute on function public.set_table_state(uuid, public.table_state) to authenticated;
