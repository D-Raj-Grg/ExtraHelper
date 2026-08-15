-- ============================================================================
-- A new restaurant gets the usual units on day one.
--
-- The back-seed in the previous migration only covered tenants that already
-- existed. Sitting on the tenants insert rather than in onboarding code so the
-- web signup, the phone, and any future path all land the same list — an
-- inventory picker that opens empty is a dead end on the very first item.
-- ============================================================================

create or replace function public.seed_default_inventory_units()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_units (tenant_id, name, kind)
  select new.id, u.name, u.kind
  from (values
    ('g','weight'), ('kg','weight'), ('mg','weight'), ('lb','weight'), ('oz','weight'),
    ('ml','volume'), ('ltr','volume'), ('l','volume'), ('gal','volume'),
    ('unit','count'), ('pcs','count'), ('dozen','count'),
    ('packet','packaging'), ('bottle','packaging'), ('can','packaging'),
    ('box','packaging'), ('carton','packaging'), ('bag','packaging'),
    ('sack','packaging'), ('crate','packaging'), ('tray','packaging'), ('roll','packaging')
  ) as u(name, kind)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_default_inventory_units on public.tenants;
create trigger trg_seed_default_inventory_units
  after insert on public.tenants
  for each row execute function public.seed_default_inventory_units();
