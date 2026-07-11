-- ============================================================================
-- Remaining public/anon actions: QR request-bill, post-visit feedback, and
-- public reservation booking (by slug). All SECURITY DEFINER, token/slug-scoped.
-- ============================================================================

-- QR: request the bill → flag the table so staff see it.
create or replace function public.qr_request_bill(_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare _tid uuid;
begin
  update public.restaurant_tables set state = 'bill_requested'
  where qr_token = _token returning id into _tid;
  return _tid is not null;
end $$;

-- QR: post-visit feedback (rating 1-5 + comment).
create or replace function public.submit_feedback(_token uuid, _rating integer, _comment text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.restaurant_tables where qr_token = _token;
  if _tenant is null then return false; end if;
  insert into public.feedback (tenant_id, rating, comment)
  values (_tenant, greatest(1, least(5, coalesce(_rating, 5))), nullif(trim(_comment), ''));
  return true;
end $$;

-- Public reservation booking by storefront slug.
create or replace function public.create_public_reservation(
  _slug text, _name text, _phone text, _party integer, _when timestamptz, _notes text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _cust uuid; _resv uuid;
begin
  select id into _tenant from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then raise exception 'restaurant not found' using errcode='P0002'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'name required' using errcode='22023'; end if;
  if _party < 1 or _party > 50 then raise exception 'invalid party size' using errcode='22023'; end if;
  if _when is null or _when < now() then raise exception 'pick a future time' using errcode='22023'; end if;

  insert into public.customers (tenant_id, name, phone) values (_tenant, _name, _phone)
  returning id into _cust;
  insert into public.reservations (tenant_id, customer_id, party_size, reserved_at, status, notes)
  values (_tenant, _cust, _party, _when, 'pending', nullif(trim(_notes),''))
  returning id into _resv;
  return _resv;
end $$;

revoke execute on function public.qr_request_bill(uuid) from public;
revoke execute on function public.submit_feedback(uuid, integer, text) from public;
revoke execute on function public.create_public_reservation(text, text, text, integer, timestamptz, text) from public;
grant execute on function public.qr_request_bill(uuid) to anon, authenticated;
grant execute on function public.submit_feedback(uuid, integer, text) to anon, authenticated;
grant execute on function public.create_public_reservation(text, text, text, integer, timestamptz, text) to anon, authenticated;
