-- Edit a flyer run after it was made: its name and its validity window. The
-- codes, the prefix and the discount are not editable — they are already printed
-- on paper — so this only touches what a run can safely change, and carries the
-- new window onto every code in it so the guest-facing checks agree.
create or replace function public.update_coupon_batch(
  _batch uuid, _name text, _valid_from timestamptz, _valid_to timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.coupon_batches where id = _batch;
  if _tenant is null then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(trim(_name), '') = '' then raise exception 'Give the run a name' using errcode = '22023'; end if;
  if _valid_from is not null and _valid_to is not null and _valid_to <= _valid_from then
    raise exception 'The coupon must end after it starts' using errcode = '22023';
  end if;

  update public.coupon_batches
  set name = trim(_name), valid_from = _valid_from, valid_to = _valid_to
  where id = _batch;
  update public.coupons
  set name = trim(_name), valid_from = _valid_from, valid_to = _valid_to
  where batch_id = _batch;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'coupon_batch_updated', 'coupon_batch', _batch,
          jsonb_build_object('name', trim(_name), 'valid_from', _valid_from, 'valid_to', _valid_to));
end $$;

revoke execute on function public.update_coupon_batch(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_coupon_batch(uuid, text, timestamptz, timestamptz) to authenticated;
