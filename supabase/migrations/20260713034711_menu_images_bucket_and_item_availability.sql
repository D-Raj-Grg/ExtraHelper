-- Wave A: Storage bucket for menu item images + per-item availability schedules.

-- 1) Storage bucket (public read; writes tenant-scoped by path first-folder = tenant_id).
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- Public read of menu images (storefront/QR are anonymous).
drop policy if exists menu_images_public_read on storage.objects;
create policy menu_images_public_read on storage.objects
  for select to public
  using (bucket_id = 'menu-images');

-- Tenant members may write into their own tenant's folder: {tenant_id}/...
drop policy if exists menu_images_tenant_write on storage.objects;
create policy menu_images_tenant_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and ((storage.foldername(name))[1])::uuid in (select public.current_tenant_ids())
  );

drop policy if exists menu_images_tenant_update on storage.objects;
create policy menu_images_tenant_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-images'
    and ((storage.foldername(name))[1])::uuid in (select public.current_tenant_ids())
  );

drop policy if exists menu_images_tenant_delete on storage.objects;
create policy menu_images_tenant_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and ((storage.foldername(name))[1])::uuid in (select public.current_tenant_ids())
  );

-- 2) Per-item availability schedules (null day_of_week = every day).
create table if not exists public.item_availability (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  item_id     uuid not null references public.menu_items(id) on delete cascade,
  day_of_week smallint,                       -- 0=Sun .. 6=Sat, null = every day
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_item_availability_tenant on public.item_availability(tenant_id);
create index if not exists idx_item_availability_item on public.item_availability(item_id);
select public.apply_tenant_rls('public.item_availability');
