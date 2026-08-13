-- ============================================================================
-- merge_receipt_template — one trusted "patch these keys, leave the rest" for
-- `tenant_settings.receipt_template`.
--
-- Why this exists: `receipt_template` is a single untyped JSONB blob written by
-- several independent surfaces — the Settings save bar (header/footer/terms),
-- the logo upload, and now the payment-QR upload, each of which fires on its
-- own. They all did read-modify-write from TypeScript:
--
--     select receipt_template -> spread in JS -> update receipt_template
--
-- which is a lost update waiting to happen. An owner who hits Save while the
-- QR upload is in flight silently drops whichever write landed first, and the
-- damage is invisible until a receipt prints without its QR. With the baked
-- print bitmaps now living in the same blob, the thing being lost is no longer
-- a line of text — it is the image that lets a guest pay.
--
-- `||` on jsonb is a shallow right-biased merge, done inside the row's own
-- update, so concurrent patches of different keys both survive. Shallow is what
-- we want: `print_assets` is replaced wholesale when re-baked, never
-- half-merged with a stale set of widths.
--
-- Passing sql null for a key deletes it (`- key`), which is how "remove logo"
-- and "remove QR" are expressed without a second function.
-- ============================================================================

create or replace function public.merge_receipt_template(_tenant uuid, _patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _out jsonb;
  _key text;
begin
  if _tenant is null then
    raise exception 'no tenant given' using errcode = '22023';
  end if;

  -- Same roles that may write tenant_settings at all (tenant_settings_owner_write).
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;

  if _patch is null or jsonb_typeof(_patch) <> 'object' then
    raise exception 'patch must be a json object' using errcode = '22023';
  end if;

  update public.tenant_settings
     set receipt_template = coalesce(receipt_template, '{}'::jsonb) || _patch
   where tenant_id = _tenant
  returning receipt_template into _out;

  if _out is null then
    raise exception 'tenant settings row is missing' using errcode = '22023';
  end if;

  -- A json null means "unset this" — drop the key rather than store a null
  -- that every reader then has to treat as absent anyway.
  for _key in select k from jsonb_each(_patch) as e(k, v) where jsonb_typeof(e.v) = 'null'
  loop
    update public.tenant_settings
       set receipt_template = receipt_template - _key
     where tenant_id = _tenant
    returning receipt_template into _out;
  end loop;

  return _out;
end $$;

-- Postgres grants EXECUTE to PUBLIC by default, so `revoke from anon` alone is
-- not enough — revoke from public, then grant to authenticated, naming the full
-- signature.
revoke execute on function public.merge_receipt_template(uuid, jsonb) from anon, public;
grant execute on function public.merge_receipt_template(uuid, jsonb) to authenticated;
