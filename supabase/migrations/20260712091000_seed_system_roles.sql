-- Default base-role → permission map (mirrors current requireRole behavior),
-- system-role seeder, backfill for existing tenants, and provision_tenant update.

create or replace function public.default_role_permissions(_base public.app_role)
returns setof text
language sql
stable
set search_path = public
as $$
  select unnest(
    case _base
      when 'owner' then array(select key from public.permissions)
      when 'manager' then array(select key from public.permissions where key <> 'billing.view')
      when 'receptionist' then array['dashboard.view','tables.view','tables.edit','reservations.view','reservations.edit','notifications.view']
      when 'cashier' then array['dashboard.view','tables.view','order.view','order.create','order.fire','checkout.view','payment.take','cash.view','cash.manage','online.view','online.manage','notifications.view','kds.view']
      when 'waiter' then array['dashboard.view','tables.view','order.view','order.create','order.fire','notifications.view']
      when 'kitchen' then array['dashboard.view','kds.view','kds.bump','order.view']
      when 'inventory' then array['dashboard.view','inventory.view','inventory.edit','purchasing.view','purchasing.edit']
      else array[]::text[]
    end
  );
$$;
grant execute on function public.default_role_permissions(public.app_role) to authenticated;

-- Idempotently create the 7 system roles (+ their default permissions) for a tenant.
create or replace function public.seed_system_roles(_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _r record; _rid uuid;
begin
  for _r in
    select * from (values
      ('owner','Owner','#dc2626'),
      ('manager','Manager','#2563eb'),
      ('receptionist','Receptionist','#7c3aed'),
      ('cashier','Cashier','#059669'),
      ('waiter','Waiter','#d97706'),
      ('kitchen','Kitchen','#ea580c'),
      ('inventory','Inventory','#0891b2')
    ) as t(base, nm, col)
  loop
    insert into public.roles (tenant_id, name, description, color, base_role, is_system)
    values (_tenant, _r.nm, 'Default ' || _r.nm || ' role', _r.col, _r.base::public.app_role, true)
    on conflict (tenant_id, name) do nothing;

    select id into _rid from public.roles where tenant_id = _tenant and name = _r.nm;
    insert into public.role_permissions (role_id, permission_key)
    select _rid, k from public.default_role_permissions(_r.base::public.app_role) k
    on conflict do nothing;
  end loop;
end $$;
revoke execute on function public.seed_system_roles(uuid) from anon, public;

-- Backfill existing tenants + point memberships at their matching system role.
do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.seed_system_roles(t.id);
    update public.user_tenants ut
    set role_id = r.id
    from public.roles r
    where ut.tenant_id = t.id and ut.role_id is null
      and r.tenant_id = t.id and r.is_system and r.base_role = ut.role;
  end loop;
end $$;

-- New tenants: seed roles + set the owner's role_id.
create or replace function public.provision_tenant(
  _name     text,
  _currency text default 'USD',
  _timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid      uuid := auth.uid();
  _existing uuid;
  _tenant   uuid;
  _base     text;
  _slug     text;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(trim(_name), '') = '' then
    raise exception 'restaurant name is required' using errcode = '22023';
  end if;

  select tenant_id into _existing
  from public.user_tenants where user_id = _uid limit 1;
  if _existing is not null then
    return _existing;
  end if;

  _base := nullif(trim(both '-' from regexp_replace(lower(_name), '[^a-z0-9]+', '-', 'g')), '');
  _base := coalesce(_base, 'restaurant');
  _slug := _base;
  while exists (select 1 from public.tenants where slug = _slug) loop
    _slug := _base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  insert into public.tenants (name, slug, status)
  values (trim(_name), _slug, 'trial')
  returning id into _tenant;

  insert into public.tenant_settings (tenant_id, currency, timezone)
  values (_tenant, coalesce(nullif(trim(_currency), ''), 'USD'),
                   coalesce(nullif(trim(_timezone), ''), 'UTC'));

  insert into public.branches (tenant_id, name, is_default)
  values (_tenant, 'Main', true);

  insert into public.user_tenants (user_id, tenant_id, role)
  values (_uid, _tenant, 'owner');

  perform public.seed_system_roles(_tenant);
  update public.user_tenants
  set role_id = (select id from public.roles where tenant_id = _tenant and is_system and base_role = 'owner' limit 1)
  where user_id = _uid and tenant_id = _tenant;

  return _tenant;
end $$;

revoke execute on function public.provision_tenant(text, text, text) from anon;
grant execute on function public.provision_tenant(text, text, text) to authenticated;
