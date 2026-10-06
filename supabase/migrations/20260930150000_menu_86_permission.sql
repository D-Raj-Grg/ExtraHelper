-- ============================================================================
-- menu.86: its own key for marking a dish sold out.
--
-- set_item_86 checked the role directly (owner, manager, kitchen) because the
-- kitchen must be able to 86 a dish without `menu.edit` (owner/manager only).
-- That left 86 outside the permission catalog: a tenant could not hand it to a
-- custom role, or take it from one. It is now a catalog key.
--
-- Additive and behaviour-identical for today's roles:
--   * catalog row + default_role_permissions: owner/manager already get every
--     key from the catalog; kitchen gets it added explicitly.
--   * backfill: every role row (system AND custom) whose base_role is owner,
--     manager or kitchen — i.e. everyone who could 86 under the old role check —
--     receives the key, so no custom role loses the ability.
--   * set_item_86 keeps its signature (CREATE OR REPLACE, ACL preserved) and
--     asks has_permission instead of has_tenant_role.
-- ============================================================================

insert into public.permissions (key, grp, label, sort) values
  ('menu.86','Menu','Mark dishes sold out (86)',235)
on conflict (key) do nothing;

-- Same body as the live definition, with menu.86 added to kitchen.
create or replace function public.default_role_permissions(_base public.app_role)
returns setof text
language sql
stable
set search_path = public
as $$
  select unnest(
    case _base
      when 'owner' then array(select key from public.permissions)
      when 'manager' then array(select key from public.permissions where key not in ('billing.view', 'profit.view'))
      when 'receptionist' then array['dashboard.view','tables.view','tables.edit','reservations.view','reservations.edit','notifications.view','expenses.create']
      when 'cashier' then array['dashboard.view','tables.view','order.view','order.create','order.fire','checkout.view','payment.take','cash.view','cash.manage','online.view','online.manage','notifications.view','kds.view','expenses.create','expenses.view']
      when 'waiter' then array['dashboard.view','tables.view','order.view','order.create','order.fire','notifications.view','expenses.create']
      when 'kitchen' then array['dashboard.view','kds.view','kds.bump','order.view','menu.86','expenses.create']
      when 'inventory' then array['dashboard.view','inventory.view','inventory.edit','purchasing.view','purchasing.edit','expenses.create']
      else array[]::text[]
    end
  );
$$;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'menu.86'
from public.roles r
where r.base_role in ('owner', 'manager', 'kitchen')
on conflict do nothing;

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

  if not public.has_permission(_tenant, 'menu.86') then
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

revoke execute on function public.set_item_86(uuid, boolean) from public, anon;
grant execute on function public.set_item_86(uuid, boolean) to authenticated;
