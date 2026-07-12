-- ============================================================================
-- Public booking timezone fix: expose the tenant's timezone via storefront_menu
-- so the public /book form can interpret its naive datetime-local wall time in
-- the restaurant's zone (not the browser/server zone) before submitting.
-- Additive: adds a 'timezone' field to the returned jsonb; grants persist.
-- ============================================================================

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
        'description', mi.description, 'price_cents', mi.base_price_cents) order by mi.name)
      from public.menu_items mi
      where mi.category_id = c.id and mi.is_active and not mi.is_86
    ), '[]'::jsonb)) as cat
    from public.menu_categories c
    where c.tenant_id = _tenant and c.is_active
  ) s;

  return jsonb_build_object('tenant_name', _name, 'currency', coalesce(_currency,'USD'),
    'timezone', coalesce(_tz,'UTC'), 'fees', _fees, 'categories', _menu);
end $$;
