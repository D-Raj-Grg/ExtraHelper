-- ============================================================================
-- Veg marker reaches guests. is_veg shows on /menu and the POS tile, but the
-- public QR + storefront menus built their JSON in SQL and omitted it — so the
-- diners who most need a veg/non-veg mark couldn't see one. Both SECURITY
-- DEFINER readers now emit `is_veg` (nullable: null = unmarked, render nothing).
--
-- Additive — a new key on each item object; grants persist. Both are the latest
-- bodies (qr_menu from 20260711014523, storefront_menu from 20260712130000).
-- ============================================================================

create or replace function public.qr_menu(_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _label  text;
  _name   text;
  _currency text;
  _menu   jsonb;
begin
  select t.tenant_id, t.label into _tenant, _label
  from public.restaurant_tables t where t.qr_token = _token;
  if _tenant is null then
    return null;
  end if;

  select name into _name from public.tenants where id = _tenant;
  select currency into _currency from public.tenant_settings where tenant_id = _tenant;

  select coalesce(jsonb_agg(cat order by cat->>'name'), '[]'::jsonb) into _menu
  from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', mi.id, 'name', mi.name,
          'description', mi.description, 'price_cents', mi.base_price_cents,
          'is_veg', mi.is_veg
        ) order by mi.name)
        from public.menu_items mi
        where mi.category_id = c.id and mi.is_active and not mi.is_86
      ), '[]'::jsonb)
    ) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object(
    'tenant_name', _name, 'currency', coalesce(_currency, 'USD'),
    'table_label', _label, 'categories', _menu
  );
end $$;

create or replace function public.storefront_menu(_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  _tenant uuid; _name text; _currency text; _tz text; _fees jsonb; _menu jsonb;
begin
  select id, name into _tenant, _name from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then return null; end if;
  select currency, timezone, coalesce(order_type_fees,'{}'::jsonb) into _currency, _tz, _fees
  from public.tenant_settings where tenant_id = _tenant;

  select coalesce(jsonb_agg(cat order by cat->>'name'), '[]'::jsonb) into _menu
  from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name,
        'description', mi.description, 'price_cents', mi.base_price_cents,
        'is_veg', mi.is_veg) order by mi.name)
      from public.menu_items mi
      where mi.category_id = c.id and mi.is_active and not mi.is_86
    ), '[]'::jsonb)) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object('tenant_name', _name, 'currency', coalesce(_currency,'USD'),
    'timezone', coalesce(_tz,'UTC'), 'fees', _fees, 'categories', _menu);
end $$;
