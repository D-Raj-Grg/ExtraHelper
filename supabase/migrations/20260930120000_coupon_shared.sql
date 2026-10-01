-- Hand-out tracking for flyer codes. A flyer shared over WhatsApp or handed over
-- the counter leaves nothing behind, so without a mark the owner cannot tell
-- which codes are still free to give out and sends the same one twice.
--
-- `shared_at` is set when the owner shares or downloads a single flyer from the
-- Flyers tab. It does not affect whether the code redeems.
--
-- `get_batch_codes` and `list_coupon_batches` gain a column. `create or replace`
-- cannot change a function's result type, so both are dropped and recreated,
-- then re-granted by full signature.
alter table public.coupons add column if not exists shared_at timestamptz;

create or replace function public.mark_coupon_shared(_batch uuid, _code text, _shared boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _n integer;
begin
  select tenant_id into _tenant from public.coupon_batches where id = _batch;
  if _tenant is null then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.coupons
  set shared_at = case when coalesce(_shared, true) then coalesce(shared_at, now()) else null end
  where batch_id = _batch and code = upper(trim(_code));
  get diagnostics _n = row_count;
  if _n = 0 then raise exception 'code not found in this run' using errcode = 'P0002'; end if;
end $$;

drop function if exists public.get_batch_codes(uuid);
create function public.get_batch_codes(_batch uuid)
returns table (code text, redeemed boolean, is_active boolean, shared boolean)
language plpgsql stable security definer set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.coupon_batches where id = _batch;
  if _tenant is null then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select c.code, c.used_count > 0, c.is_active, c.shared_at is not null
    from public.coupons c where c.batch_id = _batch
    order by c.code;
end $$;

drop function if exists public.list_coupon_batches(uuid);
create function public.list_coupon_batches(_tenant uuid)
returns table (
  id uuid, name text, type public.discount_type, value numeric,
  valid_from timestamptz, valid_to timestamptz, created_at timestamptz,
  issued bigint, redeemed bigint, active bigint, shared bigint
)
language sql stable security definer set search_path = public
as $$
  select b.id, b.name, b.type, b.value, b.valid_from, b.valid_to, b.created_at,
         count(c.id) as issued,
         count(c.id) filter (where c.used_count > 0) as redeemed,
         count(c.id) filter (where c.is_active) as active,
         count(c.id) filter (where c.shared_at is not null) as shared
  from public.coupon_batches b
  left join public.coupons c on c.batch_id = b.id
  where b.tenant_id = _tenant and public.has_permission(_tenant, 'coupons.view')
  group by b.id
  order by b.created_at desc;
$$;

revoke execute on function public.mark_coupon_shared(uuid, text, boolean) from public, anon;
revoke execute on function public.get_batch_codes(uuid) from public, anon;
revoke execute on function public.list_coupon_batches(uuid) from public, anon;
grant execute on function public.mark_coupon_shared(uuid, text, boolean) to authenticated;
grant execute on function public.get_batch_codes(uuid) to authenticated;
grant execute on function public.list_coupon_batches(uuid) to authenticated;
