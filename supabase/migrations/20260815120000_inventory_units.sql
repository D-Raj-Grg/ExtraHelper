-- ============================================================================
-- inventory_units: the tenant's own list of units of measure.
--
-- Until now a unit was only ever a string on inventory_items.uom, so the picker
-- could offer "what some item already uses" but a unit added by mistake had no
-- home to be removed from. This table is that home: add once, reuse, delete
-- when wrong. The built-in common units (kg, ltr, pcs, …) stay in code — this
-- holds only what a restaurant adds itself.
--
-- Deliberately NOT a foreign key from inventory_items.uom: existing rows carry
-- free text, the phone writes uom too, and a unit list that can refuse a save
-- would be worse than one that can't. Referential safety is enforced where it
-- matters instead — the delete path refuses while items still use the name.
-- ============================================================================

create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint inventory_units_name_len check (char_length(btrim(name)) between 1 and 24)
);

-- One "kg" per restaurant, whatever the casing someone typed it in.
create unique index if not exists inventory_units_tenant_name_uidx
  on public.inventory_units (tenant_id, lower(name));

create index if not exists inventory_units_tenant_idx
  on public.inventory_units (tenant_id);

alter table public.inventory_units enable row level security;

-- Reads open to every tenant member: the picker is on the phone too.
drop policy if exists tenant_read on public.inventory_units;
create policy tenant_read on public.inventory_units for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

-- Writes follow inventory_items exactly — same screen, same permission.
drop policy if exists tenant_write_insert on public.inventory_units;
create policy tenant_write_insert on public.inventory_units for insert to authenticated
  with check ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin());

drop policy if exists tenant_write_delete on public.inventory_units;
create policy tenant_write_delete on public.inventory_units for delete to authenticated
  using ((tenant_id in (select public.current_tenant_ids())
    and public.has_permission(tenant_id, 'inventory.edit')) or public.is_platform_admin());

-- A unit is its name; renaming one would silently orphan every item carrying
-- the old string. Delete + add instead.
revoke update on public.inventory_units from authenticated;

-- Seed each tenant's list from the units its items already use, so nothing a
-- restaurant is actually using disappears from the picker.
insert into public.inventory_units (tenant_id, name)
select distinct i.tenant_id, btrim(i.uom)
from public.inventory_items i
where btrim(coalesce(i.uom, '')) <> ''
  and char_length(btrim(i.uom)) <= 24
on conflict do nothing;
