-- ============================================================================
-- Units, part two: every unit a restaurant sees is now a row it owns.
--
-- Part one kept the common units (kg, ltr, pcs …) in code and only stored what
-- a tenant typed itself. That made the manage screen a half-truth: most of the
-- list couldn't be renamed or removed because it wasn't there. Seeding the
-- defaults per tenant makes the list honest — everything shown can be edited,
-- and a restaurant that never weighs anything can drop the weight units.
--
-- `kind` only groups the picker (Weight / Volume / …). Free text, nullable:
-- a unit someone adds has no kind and lands under "Yours".
-- ============================================================================

alter table public.inventory_units
  add column if not exists kind text;

-- Seed the defaults for every existing tenant. Same list as lib/units.ts.
insert into public.inventory_units (tenant_id, name, kind)
select t.id, u.name, u.kind
from public.tenants t
cross join (values
  ('g','weight'), ('kg','weight'), ('mg','weight'), ('lb','weight'), ('oz','weight'),
  ('ml','volume'), ('ltr','volume'), ('l','volume'), ('gal','volume'),
  ('unit','count'), ('pcs','count'), ('dozen','count'),
  ('packet','packaging'), ('bottle','packaging'), ('can','packaging'),
  ('box','packaging'), ('carton','packaging'), ('bag','packaging'),
  ('sack','packaging'), ('crate','packaging'), ('tray','packaging'), ('roll','packaging')
) as u(name, kind)
on conflict do nothing;

-- Backfill kind on rows seeded in part one from items' uom, so "kg" typed by a
-- restaurant sits under Weight rather than in a separate pile.
update public.inventory_units iu
set kind = v.kind
from (values
  ('g','weight'), ('kg','weight'), ('mg','weight'), ('lb','weight'), ('oz','weight'),
  ('ml','volume'), ('ltr','volume'), ('l','volume'), ('gal','volume'),
  ('unit','count'), ('pcs','count'), ('dozen','count'),
  ('packet','packaging'), ('bottle','packaging'), ('can','packaging'),
  ('box','packaging'), ('carton','packaging'), ('bag','packaging'),
  ('sack','packaging'), ('crate','packaging'), ('tray','packaging'), ('roll','packaging')
) as v(name, kind)
where iu.kind is null and lower(iu.name) = v.name;

-- ---------------------------------------------------------------------------
-- Rename, as one transaction.
--
-- `inventory_items.uom` is free text with no FK, so renaming the row alone
-- would leave every item pointing at a unit that no longer exists — the old
-- string would reappear in the picker as an orphan the moment the page
-- reloaded. This repoints the items first, then the unit. UPDATE stays revoked
-- to `authenticated`: this definer function is the only way in.
-- ---------------------------------------------------------------------------
create or replace function public.rename_inventory_unit(_unit_id uuid, _new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_old text;
  v_new text := btrim(_new_name);
begin
  select tenant_id, name into v_tenant, v_old
  from public.inventory_units where id = _unit_id;

  if v_tenant is null then
    raise exception 'That unit no longer exists.' using errcode = 'P0002';
  end if;

  if not public.has_permission(v_tenant, 'inventory.edit') then
    raise exception 'You do not have permission to edit inventory.' using errcode = '42501';
  end if;

  if char_length(v_new) < 1 or char_length(v_new) > 24 then
    raise exception 'A unit name is 1 to 24 characters.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.inventory_units
    where tenant_id = v_tenant and id <> _unit_id and lower(name) = lower(v_new)
  ) then
    raise exception '"%" is already on the list.', v_new using errcode = '23505';
  end if;

  -- Items first: if this fails, the unit keeps its old name and nothing is
  -- left dangling.
  update public.inventory_items
  set uom = v_new
  where tenant_id = v_tenant and lower(btrim(uom)) = lower(v_old);

  update public.inventory_units set name = v_new where id = _unit_id;
end;
$$;

revoke all on function public.rename_inventory_unit(uuid, text) from public;
grant execute on function public.rename_inventory_unit(uuid, text) to authenticated;
