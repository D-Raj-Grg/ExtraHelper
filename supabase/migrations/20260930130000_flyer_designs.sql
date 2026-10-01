-- ============================================================================
-- Saved flyer designs: the template image and where the code and QR sit on it,
-- kept on the server so any device, any login, any later day can print or share
-- a run without uploading the template again.
--
-- The image lives in a PRIVATE bucket (`flyer-templates`), path
-- {tenant_id}/{random}.{ext}: a fresh name per upload, so no upsert is needed and
-- a stale signed URL can never show an older picture. The placement is a few
-- fractions of the image, so it is jsonb on the design row.
--
--   * read the image / list designs: coupons.view
--   * upload / delete the image, save / delete a design: coupons.manage
--
-- A run points at its design (`coupon_batches.design_id`), so opening a run
-- brings its design back with it. Deleting a design leaves its runs in place.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flyer-templates', 'flyer-templates', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Does the first folder of a storage path name a tenant the caller belongs to
-- and holds `_perm` in? Text comparison, so a malformed folder is false, not a cast error.
create or replace function public.may_use_flyer_template(_name text, _perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from (select public.current_tenant_ids() as id) t
    where t.id::text = (storage.foldername(_name))[1]
      and public.has_permission(t.id, _perm)
  );
$$;
revoke execute on function public.may_use_flyer_template(text, text) from public, anon;
grant  execute on function public.may_use_flyer_template(text, text) to authenticated;

drop policy if exists flyer_templates_read on storage.objects;
create policy flyer_templates_read on storage.objects
  for select to authenticated
  using (bucket_id = 'flyer-templates' and public.may_use_flyer_template(name, 'coupons.view'));

drop policy if exists flyer_templates_write on storage.objects;
create policy flyer_templates_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flyer-templates' and public.may_use_flyer_template(name, 'coupons.manage'));

drop policy if exists flyer_templates_delete on storage.objects;
create policy flyer_templates_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'flyer-templates' and public.may_use_flyer_template(name, 'coupons.manage'));

create table if not exists public.flyer_designs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  image_path  text not null,
  width       integer not null check (width > 0),
  height      integer not null check (height > 0),
  placement   jsonb not null,
  mode        text not null default 'url' check (mode in ('url', 'code')),
  link_base   text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_flyer_designs_tenant on public.flyer_designs(tenant_id, updated_at desc);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_flyer_designs_updated') then
    create trigger trg_flyer_designs_updated before update on public.flyer_designs
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.flyer_designs enable row level security;
drop policy if exists flyer_designs_select on public.flyer_designs;
create policy flyer_designs_select on public.flyer_designs
  for select to authenticated
  using (
    (tenant_id in (select public.current_tenant_ids())
     and public.has_permission(tenant_id, 'coupons.view'))
    or public.is_platform_admin()
  );
revoke insert, update, delete, truncate, references, trigger on public.flyer_designs from anon, authenticated;

alter table public.coupon_batches
  add column if not exists design_id uuid references public.flyer_designs(id) on delete set null;

-- Create (`_id` null) or update a design, optionally pointing a run at it. A
-- null `_image_path` on an update keeps the picture already stored.
create or replace function public.save_flyer_design(
  _tenant uuid, _id uuid, _name text, _image_path text, _width integer, _height integer,
  _placement jsonb, _mode text, _link_base text, _batch uuid
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare _out uuid; _prefix text := _tenant::text || '/';
begin
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(trim(_name), '') = '' or char_length(trim(_name)) > 80 then
    raise exception 'Give the design a name (up to 80 characters)' using errcode = '22023';
  end if;
  if _mode not in ('url', 'code') then raise exception 'unknown QR mode' using errcode = '22023'; end if;
  if _width is null or _height is null or _width < 1 or _height < 1 then
    raise exception 'The template size is missing' using errcode = '22023';
  end if;
  if _placement is null or jsonb_typeof(_placement) <> 'object' then
    raise exception 'The placement is missing' using errcode = '22023';
  end if;
  if _image_path is not null and left(_image_path, length(_prefix)) <> _prefix then
    raise exception 'The template belongs to another restaurant' using errcode = '42501';
  end if;
  if _batch is not null and not exists (select 1 from public.coupon_batches where id = _batch and tenant_id = _tenant) then
    raise exception 'run not found' using errcode = 'P0002';
  end if;

  if _id is null then
    if _image_path is null then raise exception 'Upload the template first' using errcode = '22023'; end if;
    insert into public.flyer_designs (tenant_id, name, image_path, width, height, placement, mode, link_base, created_by)
    values (_tenant, trim(_name), _image_path, _width, _height, _placement, _mode, nullif(trim(coalesce(_link_base, '')), ''), auth.uid())
    returning id into _out;
  else
    update public.flyer_designs
    set name = trim(_name), image_path = coalesce(_image_path, image_path), width = _width, height = _height,
        placement = _placement, mode = _mode, link_base = nullif(trim(coalesce(_link_base, '')), '')
    where id = _id and tenant_id = _tenant
    returning id into _out;
    if _out is null then raise exception 'design not found' using errcode = 'P0002'; end if;
  end if;

  if _batch is not null then
    update public.coupon_batches set design_id = _out where id = _batch;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'flyer_design_saved', 'flyer_design', _out,
          jsonb_build_object('name', trim(_name), 'mode', _mode, 'batch', _batch));
  return _out;
end $$;

create or replace function public.list_flyer_designs(_tenant uuid)
returns table (
  id uuid, name text, image_path text, width integer, height integer,
  placement jsonb, mode text, link_base text, updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select d.id, d.name, d.image_path, d.width, d.height, d.placement, d.mode, d.link_base, d.updated_at
  from public.flyer_designs d
  where d.tenant_id = _tenant and public.has_permission(_tenant, 'coupons.view')
  order by d.updated_at desc;
$$;

-- Returns the stored image path so the caller can remove the file.
create or replace function public.delete_flyer_design(_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _path text; _name text;
begin
  select tenant_id, image_path, name into _tenant, _path, _name from public.flyer_designs where id = _id;
  if _tenant is null then raise exception 'design not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  delete from public.flyer_designs where id = _id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'flyer_design_deleted', 'flyer_design', _id, jsonb_build_object('name', _name));
  return _path;
end $$;

-- `list_coupon_batches` gains `design_id`: a result-type change, so drop + create + re-grant.
drop function if exists public.list_coupon_batches(uuid);
create function public.list_coupon_batches(_tenant uuid)
returns table (
  id uuid, name text, type public.discount_type, value numeric,
  valid_from timestamptz, valid_to timestamptz, created_at timestamptz,
  issued bigint, redeemed bigint, active bigint, shared bigint, design_id uuid
)
language sql stable security definer set search_path = public
as $$
  select b.id, b.name, b.type, b.value, b.valid_from, b.valid_to, b.created_at,
         count(c.id) as issued,
         count(c.id) filter (where c.used_count > 0) as redeemed,
         count(c.id) filter (where c.is_active) as active,
         count(c.id) filter (where c.shared_at is not null) as shared,
         b.design_id
  from public.coupon_batches b
  left join public.coupons c on c.batch_id = b.id
  where b.tenant_id = _tenant and public.has_permission(_tenant, 'coupons.view')
  group by b.id
  order by b.created_at desc;
$$;

revoke execute on function public.save_flyer_design(uuid, uuid, text, text, integer, integer, jsonb, text, text, uuid) from public, anon;
revoke execute on function public.list_flyer_designs(uuid) from public, anon;
revoke execute on function public.delete_flyer_design(uuid) from public, anon;
revoke execute on function public.list_coupon_batches(uuid) from public, anon;
grant execute on function public.save_flyer_design(uuid, uuid, text, text, integer, integer, jsonb, text, text, uuid) to authenticated;
grant execute on function public.list_flyer_designs(uuid) to authenticated;
grant execute on function public.delete_flyer_design(uuid) to authenticated;
grant execute on function public.list_coupon_batches(uuid) to authenticated;
