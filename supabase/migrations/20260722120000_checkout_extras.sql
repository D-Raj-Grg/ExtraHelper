-- ============================================================================
-- Checkout extras: tip, round-off, bill note, extra charges, complimentary.
--
-- The total gains three new components (charges, tip, rounding). Every path
-- that writes bills.total_cents therefore has to agree on the formula — so
-- this migration also collapses the hand-rolled `subtotal + service + tax -
-- discount` updates inside apply_bill_discount / apply_coupon onto
-- recompute_bill, the single source of truth. Without that, applying a
-- discount after a tip would silently wipe the tip.
--
-- Formula (recompute_bill):
--   total = subtotal + service + packaging + tax + charges - discount
--           + tip + rounding      (clamped at >= 0)
-- Discounts are capped at the pre-tip gross, so a discount can zero the bill
-- but never turn it negative, and a tip is never discounted away.
-- ============================================================================

alter table public.bills
  add column if not exists tip_cents      integer not null default 0,
  add column if not exists rounding_cents integer not null default 0,
  add column if not exists note           text;

-- Extra charges (delivery, packing, corkage, …). One row per charge so the
-- receipt can name each one, rather than a single opaque "other" bucket.
create table if not exists public.bill_charges (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  bill_id      uuid not null references public.bills(id) on delete cascade,
  label        text not null,
  amount_cents integer not null check (amount_cents > 0),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_bill_charges_bill on public.bill_charges(bill_id);
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'bill_charges' and policyname = 'tenant_all') then
    perform public.apply_tenant_rls('public.bill_charges');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- recompute_bill: fold charges/tip/rounding into the total. Same arity, so
-- `create or replace` replaces the body rather than creating an overload.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_bill(_bill_id uuid)
returns void language plpgsql set search_path = public
as $$
declare
  _tenant uuid; _otype public.order_type; _subtotal integer := 0;
  _service_pct numeric := 0; _packaging numeric := 0; _tax_rules jsonb := '[]';
  _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0;
  _discount integer := 0; _charges integer := 0; _tip integer := 0; _rounding integer := 0;
  _gross integer := 0;
begin
  select tenant_id, coalesce(tip_cents, 0), coalesce(rounding_cents, 0)
    into _tenant, _tip, _rounding
  from public.bills where id = _bill_id;
  if _tenant is null then return; end if;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0) into _subtotal
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;

  select order_type into _otype from public.orders where bill_id = _bill_id limit 1;
  select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;

  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then _packaging_cents := round(coalesce(_packaging, 0) * 100); end if;

  select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r
  where coalesce((r->>'inclusive')::boolean, false) = false;

  select coalesce(sum(amount_cents), 0) into _charges
  from public.bill_charges where bill_id = _bill_id;

  -- Discountable gross excludes the tip: a tip is the customer's money for the
  -- staff, not revenue to discount against.
  _gross := _subtotal + _service_cents + _packaging_cents + _tax_cents + _charges;
  _discount := least(public.bill_discount_total(_bill_id, _subtotal), _gross);

  update public.bills
  set subtotal_cents = _subtotal,
      service_charge_cents = _service_cents + _packaging_cents,
      tax_cents = _tax_cents,
      discount_cents = _discount,
      total_cents = greatest(_gross - _discount + _tip + _rounding, 0)
  where id = _bill_id;

  delete from public.bill_items where bill_id = _bill_id;
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description, qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill_id, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents, 0, oi.unit_price_cents * oi.qty
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;
end $$;

revoke execute on function public.recompute_bill(uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Discount paths: recompute instead of hand-rolling the total, so the new
-- components survive. Gates + audit rows unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.apply_bill_discount(_bill_id uuid, _type public.discount_type, _value numeric, _reason text default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _total integer;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, _type, _value, _reason, auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

create or replace function public.apply_coupon(_bill_id uuid, _code text)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _total integer; _c public.coupons; _norm text; _bumped integer;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  _norm := upper(trim(coalesce(_code, '')));
  if _norm = '' then raise exception 'enter a coupon code' using errcode = '22023'; end if;

  select * into _c from public.coupons where tenant_id = _tenant and upper(code) = _norm limit 1;
  if _c.id is null then raise exception 'invalid coupon' using errcode = '22023'; end if;
  if not _c.active then raise exception 'coupon is inactive' using errcode = '22023'; end if;
  if _c.expires_at is not null and _c.expires_at < now() then raise exception 'coupon has expired' using errcode = '22023'; end if;
  if _c.type = 'percent' and _c.value > 100 then raise exception 'coupon percent cannot exceed 100' using errcode = '22023'; end if;
  if exists (select 1 from public.discounts where bill_id = _bill_id and upper(coupon_code) = _norm) then
    raise exception 'coupon already applied to this bill' using errcode = '22023';
  end if;

  -- Atomic usage-cap enforcement: only bump if still under max_uses.
  update public.coupons set used_count = used_count + 1
  where id = _c.id and (max_uses is null or used_count < max_uses);
  get diagnostics _bumped = row_count;
  if _bumped = 0 then raise exception 'coupon usage limit reached' using errcode = '22023'; end if;

  insert into public.discounts (tenant_id, bill_id, type, value, coupon_code, reason, approved_by)
  values (_tenant, _bill_id, _c.type, _c.value, _c.code, 'coupon', auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('coupon', _c.code, 'type', _c.type, 'value', _c.value));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- ---------------------------------------------------------------------------
-- New checkout RPCs.
-- ---------------------------------------------------------------------------

-- Add a named extra charge to an open bill (manager-gated, audited).
create or replace function public.add_bill_charge(_bill_id uuid, _label text, _amount_cents integer)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _id uuid; _norm text;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status not in ('open', 'partial') then
    raise exception 'bill already settled' using errcode = '22023';
  end if;

  _norm := trim(coalesce(_label, ''));
  if _norm = '' then raise exception 'charge needs a label' using errcode = '22023'; end if;
  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'charge must be positive' using errcode = '22023';
  end if;

  insert into public.bill_charges (tenant_id, bill_id, label, amount_cents, created_by)
  values (_tenant, _bill_id, left(_norm, 60), _amount_cents, auth.uid())
  returning id into _id;

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'charge_add', 'bill', _bill_id,
          jsonb_build_object('label', _norm, 'amount_cents', _amount_cents));
  return _id;
end $$;

create or replace function public.remove_bill_charge(_charge_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _bill uuid; _status public.bill_status; _label text; _amount integer;
begin
  select tenant_id, bill_id, label, amount_cents into _tenant, _bill, _label, _amount
  from public.bill_charges where id = _charge_id;
  if _tenant is null then raise exception 'charge not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select status into _status from public.bills where id = _bill;
  if _status not in ('open', 'partial') then
    raise exception 'bill already settled' using errcode = '22023';
  end if;

  delete from public.bill_charges where id = _charge_id;
  perform public.recompute_bill(_bill);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'charge_remove', 'bill', _bill,
          jsonb_build_object('label', _label, 'amount_cents', _amount));
end $$;

-- Tip / round-off / invoice remark. Cashier-usable: none of these can reduce
-- revenue beyond a sub-unit rounding, so they don't need a manager.
create or replace function public.set_bill_extras(
  _bill_id uuid,
  _tip_cents integer,
  _rounding_cents integer,
  _note text default null
)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _total integer;
begin
  select tenant_id, status into _tenant, _status from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status not in ('open', 'partial') then
    raise exception 'bill already settled' using errcode = '22023';
  end if;
  if coalesce(_tip_cents, 0) < 0 then raise exception 'tip cannot be negative' using errcode = '22023'; end if;
  -- A round-off is under one currency unit. Anything larger is a discount and
  -- must go through the manager-gated discount path instead.
  if abs(coalesce(_rounding_cents, 0)) > 99 then
    raise exception 'round off must be under one unit' using errcode = '22023';
  end if;

  update public.bills
  set tip_cents = coalesce(_tip_cents, 0),
      rounding_cents = coalesce(_rounding_cents, 0),
      note = nullif(left(trim(coalesce(_note, '')), 500), '')
  where id = _bill_id;

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'bill_extras', 'bill', _bill_id,
          jsonb_build_object('tip_cents', coalesce(_tip_cents, 0),
                             'rounding_cents', coalesce(_rounding_cents, 0)));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- Comp the whole bill: a flat discount for the current gross. recompute_bill
-- caps the discount at the gross, so the bill lands at exactly the tip (0 when
-- there is none) rather than going negative.
create or replace function public.set_bill_complimentary(_bill_id uuid, _reason text)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _status public.bill_status; _gross integer; _total integer;
begin
  select tenant_id, status, subtotal_cents + service_charge_cents + tax_cents
    into _tenant, _status, _gross
  from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'order.discount') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _status not in ('open', 'partial') then
    raise exception 'bill already settled' using errcode = '22023';
  end if;
  if trim(coalesce(_reason, '')) = '' then
    raise exception 'complimentary needs a reason' using errcode = '22023';
  end if;

  select _gross + coalesce(sum(amount_cents), 0) into _gross
  from public.bill_charges where bill_id = _bill_id;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, 'flat', _gross / 100.0, left(trim(_reason), 200), auth.uid());

  perform public.recompute_bill(_bill_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'complimentary', 'bill', _bill_id,
          jsonb_build_object('gross_cents', _gross, 'reason', trim(_reason)));

  select total_cents into _total from public.bills where id = _bill_id;
  return _total;
end $$;

-- Grants name the full signatures: a new arg list is a new function object and
-- old grants don't carry over, while `public` holds EXECUTE by default.
revoke execute on function public.add_bill_charge(uuid, text, integer) from anon, public;
revoke execute on function public.remove_bill_charge(uuid) from anon, public;
revoke execute on function public.set_bill_extras(uuid, integer, integer, text) from anon, public;
revoke execute on function public.set_bill_complimentary(uuid, text) from anon, public;
grant execute on function public.add_bill_charge(uuid, text, integer) to authenticated;
grant execute on function public.remove_bill_charge(uuid) to authenticated;
grant execute on function public.set_bill_extras(uuid, integer, integer, text) to authenticated;
grant execute on function public.set_bill_complimentary(uuid, text) to authenticated;
