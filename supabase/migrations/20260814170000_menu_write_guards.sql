-- Menu editing: a real boundary, and an API the phone can use.
--
-- Two problems, one migration.
--
-- 1. **The role check was only in the web action.** Every menu table carried
--    the plain `tenant_all` policy — one `for all` policy whose only test is
--    tenant membership — so a waiter's token could PATCH `item_variants`
--    straight through PostgREST and reprice the menu. `requireRole` in
--    `app/(app)/menu/actions.ts` guards the button, not the table. Reads stay
--    open to every member (the POS, KDS and offline cache all need them);
--    writes now require `menu.edit`, which only owner/manager hold by default.
--
-- 2. **The mobile app had no way in.** It talks to PostgREST directly, so
--    "just call the server action" is not available to it. The variant
--    operations move into `security definer` RPCs both clients call, which
--    also means the renumbering logic exists once instead of twice.
--
-- The one write that is NOT a menu edit: `item_variants.recipe_scale`. That is
-- the store keeper's field (Half burns 0.5 of the recipe), and the inventory
-- role does not hold `menu.edit` — so it gets its own RPC gated on
-- `inventory.edit`, or tightening the table would have broken stock counts.

-- ============================================================================
-- Policies: read = any member, write = menu.edit
-- ============================================================================

do $$
declare _t text;
begin
  foreach _t in array array[
    'menu_categories', 'menu_items', 'item_variants', 'item_modifiers',
    'item_availability', 'item_station_routes', 'modifiers', 'combos',
    'kitchen_stations', 'menus', 'menu_schedules', 'menu_item_prices'
  ]
  loop
    execute format('drop policy if exists tenant_all on public.%I', _t);
    execute format('drop policy if exists tenant_read on public.%I', _t);
    execute format('drop policy if exists tenant_write on public.%I', _t);

    execute format(
      'create policy tenant_read on public.%I for select to authenticated '
      'using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())',
      _t);

    -- One `for all` policy would re-open reads to menu.edit holders only, so
    -- the three write commands are named explicitly and select is left alone.
    execute format(
      'create policy tenant_write_insert on public.%I for insert to authenticated '
      'with check ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''menu.edit'')) or public.is_platform_admin())',
      _t);
    execute format(
      'create policy tenant_write_update on public.%I for update to authenticated '
      'using ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''menu.edit'')) or public.is_platform_admin()) '
      'with check ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''menu.edit'')) or public.is_platform_admin())',
      _t);
    execute format(
      'create policy tenant_write_delete on public.%I for delete to authenticated '
      'using ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''menu.edit'')) or public.is_platform_admin())',
      _t);
  end loop;
end $$;

-- The recipe half of the menu is the store keeper's, not the menu editor's.
do $$
declare _t text;
begin
  foreach _t in array array['recipes', 'modifier_ingredients']
  loop
    execute format('drop policy if exists tenant_all on public.%I', _t);
    execute format('drop policy if exists tenant_read on public.%I', _t);

    execute format(
      'create policy tenant_read on public.%I for select to authenticated '
      'using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin())',
      _t);
    execute format(
      'create policy tenant_write_insert on public.%I for insert to authenticated '
      'with check ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''inventory.edit'')) or public.is_platform_admin())',
      _t);
    execute format(
      'create policy tenant_write_update on public.%I for update to authenticated '
      'using ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''inventory.edit'')) or public.is_platform_admin()) '
      'with check ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''inventory.edit'')) or public.is_platform_admin())',
      _t);
    execute format(
      'create policy tenant_write_delete on public.%I for delete to authenticated '
      'using ((tenant_id in (select public.current_tenant_ids()) '
      'and public.has_permission(tenant_id, ''inventory.edit'')) or public.is_platform_admin())',
      _t);
  end loop;
end $$;

-- ============================================================================
-- Variant RPCs — one implementation, both clients
-- ============================================================================

/** Shared gate: menu editing is an owner/manager job holding `menu.edit`. */
create or replace function public.assert_may_edit_menu(_tenant uuid)
returns void language plpgsql stable security definer set search_path = 'public'
as $$
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'menu changes require a manager' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'menu.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
end $$;

create or replace function public.add_variant(
  _item_id uuid, _name text, _price_delta_cents integer
) returns uuid language plpgsql security definer set search_path = 'public'
as $$
declare _tenant uuid; _name_t text; _id uuid;
begin
  select tenant_id into _tenant from public.menu_items where id = _item_id;
  if _tenant is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_menu(_tenant);

  _name_t := nullif(trim(_name), '');
  if _name_t is null then raise exception 'variant name is required' using errcode = '22023'; end if;
  -- A delta may be negative (Half −200), so the only bound is sanity.
  if abs(coalesce(_price_delta_cents, 0)) > 100000000 then
    raise exception 'price change out of range' using errcode = '22023';
  end if;

  -- New variants land at the bottom: appending is what the owner just did, so
  -- anything else would look like the row jumped.
  insert into public.item_variants (tenant_id, item_id, name, price_delta_cents, sort)
  values (
    _tenant, _item_id, _name_t, coalesce(_price_delta_cents, 0),
    coalesce((select max(sort) from public.item_variants where item_id = _item_id), 0) + 1
  )
  returning id into _id;
  return _id;
end $$;

create or replace function public.update_variant(
  _variant_id uuid, _name text, _price_delta_cents integer
) returns void language plpgsql security definer set search_path = 'public'
as $$
declare _tenant uuid; _name_t text;
begin
  select tenant_id into _tenant from public.item_variants where id = _variant_id;
  if _tenant is null then raise exception 'variant not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_menu(_tenant);

  _name_t := nullif(trim(_name), '');
  if _name_t is null then raise exception 'variant name is required' using errcode = '22023'; end if;
  if abs(coalesce(_price_delta_cents, 0)) > 100000000 then
    raise exception 'price change out of range' using errcode = '22023';
  end if;

  update public.item_variants
  set name = _name_t, price_delta_cents = coalesce(_price_delta_cents, 0)
  where id = _variant_id;
end $$;

create or replace function public.delete_variant(_variant_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.item_variants where id = _variant_id;
  if _tenant is null then return; end if;  -- already gone; deleting twice is not an error
  perform public.assert_may_edit_menu(_tenant);
  delete from public.item_variants where id = _variant_id;
end $$;

/**
 * Move a variant one position up or down within its item.
 *
 * Renumbers the item 1..n rather than swapping two rows: rows created before
 * `sort` existed can share the value 0, and a swap between two equal values is
 * a silent no-op. Returns the variant's new 1-based position.
 */
create or replace function public.move_variant(_variant_id uuid, _direction text)
returns integer language plpgsql security definer set search_path = 'public'
as $$
declare
  _tenant uuid; _item uuid; _from integer; _to integer; _n integer;
begin
  if _direction not in ('up', 'down') then
    raise exception 'direction must be up or down' using errcode = '22023';
  end if;

  select tenant_id, item_id into _tenant, _item
  from public.item_variants where id = _variant_id;
  if _tenant is null then raise exception 'variant not found' using errcode = 'P0002'; end if;
  perform public.assert_may_edit_menu(_tenant);

  -- Position is derived, never trusted from the row: `sort` may be 0 on every
  -- row of a pre-backfill item, and `name, id` break that tie the same way the
  -- read paths do.
  select pos, cnt into _from, _n
  from (
    select id,
           row_number() over (order by sort, name, id) as pos,
           count(*) over () as cnt
    from public.item_variants where item_id = _item
  ) t
  where t.id = _variant_id;

  _to := case when _direction = 'up' then _from - 1 else _from + 1 end;
  if _to < 1 or _to > _n then return _from; end if;  -- already at the edge

  update public.item_variants v
  set sort = o.new_pos
  from (
    select id,
           case
             when pos = _from then _to
             when pos = _to   then _from
             else pos
           end as new_pos
    from (
      select id, row_number() over (order by sort, name, id) as pos
      from public.item_variants where item_id = _item
    ) x
  ) o
  where v.id = o.id and v.sort is distinct from o.new_pos;

  return _to;
end $$;

/**
 * Portion scale for stock deduction (Half = 0.5). Lives on `item_variants` but
 * is an inventory decision, so it is gated on `inventory.edit` — the store
 * keeper who counts the stock does not hold `menu.edit` and must not need it.
 */
create or replace function public.set_variant_recipe_scale(_variant_id uuid, _scale numeric)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.item_variants where id = _variant_id;
  if _tenant is null then raise exception 'variant not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'inventory') then
    raise exception 'recipe scale requires stock access' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'inventory.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _scale is null or _scale < 0 or _scale > 100 then
    raise exception 'scale must be between 0 and 100' using errcode = '22023';
  end if;

  update public.item_variants set recipe_scale = _scale where id = _variant_id;
end $$;

-- This project's default privileges hand `anon` its own EXECUTE grant on every
-- new function, so revoking from `public` alone leaves the route open — revoke
-- from both, then grant to `authenticated`.
do $$
declare _sig text;
begin
  foreach _sig in array array[
    'public.assert_may_edit_menu(uuid)',
    'public.add_variant(uuid, text, integer)',
    'public.update_variant(uuid, text, integer)',
    'public.delete_variant(uuid)',
    'public.move_variant(uuid, text)',
    'public.set_variant_recipe_scale(uuid, numeric)'
  ]
  loop
    execute format('revoke all on function %s from public', _sig);
    execute format('revoke all on function %s from anon', _sig);
    execute format('grant execute on function %s to authenticated', _sig);
  end loop;
end $$;

-- `assert_may_edit_menu` is only ever called by the definer functions above.
revoke execute on function public.assert_may_edit_menu(uuid) from authenticated;
