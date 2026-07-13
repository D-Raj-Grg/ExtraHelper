-- ============================================================================
-- Item-level discounts + coupon codes.
--   * bill_discount_total(_bill_id, _subtotal): single source of truth for a
--     bill's discount — bill-level rows apply to the subtotal, item-level rows
--     apply to their own (non-void) line, flat item discounts capped at the line.
--   * apply_bill_discount + recompute_bill rewired to use it, so item discounts
--     survive a recompute (void / further discount) instead of being ignored.
--   * apply_item_discount: manager-gated per-line discount.
--   * coupons table + apply_coupon: validated code → a bill-level discount row.
-- ============================================================================

-- Unified discount computation for a bill (in cents).
create or replace function public.bill_discount_total(_bill_id uuid, _subtotal integer)
returns integer language sql stable set search_path = public
as $$
  select coalesce(sum(
    case
      when d.order_item_id is not null then
        case when d.type = 'percent'
             then round(oi.unit_price_cents * oi.qty * d.value / 100.0)
             else least(round(d.value * 100), oi.unit_price_cents * oi.qty) end
      else
        case when d.type = 'percent'
             then round(_subtotal * d.value / 100.0)
             else round(d.value * 100) end
    end
  ), 0)::integer
  from public.discounts d
  left join public.order_items oi on oi.id = d.order_item_id
  where d.bill_id = _bill_id
    and (d.order_item_id is null or oi.is_void = false);
$$;

-- Rewire apply_bill_discount to the shared calc (now counts item-level rows too).
create or replace function public.apply_bill_discount(_bill_id uuid, _type public.discount_type, _value numeric, _reason text default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _subtotal integer; _service integer; _tax integer; _discount integer := 0;
begin
  select tenant_id, subtotal_cents, service_charge_cents, tax_cents
    into _tenant, _subtotal, _service, _tax
  from public.bills where id = _bill_id;
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

  _discount := least(public.bill_discount_total(_bill_id, _subtotal), _subtotal + _service + _tax);
  update public.bills
  set discount_cents = _discount, total_cents = _subtotal + _service + _tax - _discount
  where id = _bill_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));
  return _subtotal + _service + _tax - _discount;
end $$;

-- Per-line (item-level) discount. Manager-gated + audited; recompute keeps it.
create or replace function public.apply_item_discount(_order_item_id uuid, _type public.discount_type, _value numeric, _reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _bill uuid; _bill_status public.bill_status;
begin
  select tenant_id, order_id into _tenant, _order from public.order_items where id = _order_item_id;
  if _tenant is null then raise exception 'order item not found' using errcode = 'P0002'; end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if _value <= 0 then raise exception 'discount must be positive' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;

  select bill_id into _bill from public.orders where id = _order;
  if _bill is null then raise exception 'item is not on a bill yet' using errcode = '22023'; end if;
  select status into _bill_status from public.bills where id = _bill;
  if _bill_status = 'paid' then raise exception 'bill already settled' using errcode = '22023'; end if;

  insert into public.discounts (tenant_id, bill_id, order_item_id, type, value, reason, approved_by)
  values (_tenant, _bill, _order_item_id, _type, _value, _reason, auth.uid());

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'order_item', _order_item_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  perform public.recompute_bill(_bill);
end $$;

-- Coupons ---------------------------------------------------------------------
create table if not exists public.coupons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  code        text not null,
  type        public.discount_type not null,
  value       numeric(10,2) not null,
  active      boolean not null default true,
  expires_at  timestamptz,
  max_uses    integer,
  used_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists idx_coupons_tenant on public.coupons(tenant_id);
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'coupons' and policyname = 'tenant_all') then
    perform public.apply_tenant_rls('public.coupons');
  end if;
end $$;

-- Validate + apply a coupon as a bill-level discount. Cashier-usable (a coupon
-- is pre-approved, unlike a discretionary manager discount).
create or replace function public.apply_coupon(_bill_id uuid, _code text)
returns integer language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _subtotal integer; _service integer; _tax integer; _discount integer;
        _c public.coupons; _norm text;
begin
  select tenant_id, subtotal_cents, service_charge_cents, tax_cents
    into _tenant, _subtotal, _service, _tax
  from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  _norm := upper(trim(coalesce(_code, '')));
  if _norm = '' then raise exception 'enter a coupon code' using errcode = '22023'; end if;

  select * into _c from public.coupons
  where tenant_id = _tenant and upper(code) = _norm;
  if _c.id is null then raise exception 'invalid coupon' using errcode = '22023'; end if;
  if not _c.active then raise exception 'coupon is inactive' using errcode = '22023'; end if;
  if _c.expires_at is not null and _c.expires_at < now() then
    raise exception 'coupon has expired' using errcode = '22023';
  end if;
  if _c.max_uses is not null and _c.used_count >= _c.max_uses then
    raise exception 'coupon usage limit reached' using errcode = '22023';
  end if;
  if exists (select 1 from public.discounts where bill_id = _bill_id and upper(coupon_code) = _norm) then
    raise exception 'coupon already applied to this bill' using errcode = '22023';
  end if;

  insert into public.discounts (tenant_id, bill_id, type, value, coupon_code, reason, approved_by)
  values (_tenant, _bill_id, _c.type, _c.value, _c.code, 'coupon', auth.uid());
  update public.coupons set used_count = used_count + 1 where id = _c.id;

  _discount := least(public.bill_discount_total(_bill_id, _subtotal), _subtotal + _service + _tax);
  update public.bills
  set discount_cents = _discount, total_cents = _subtotal + _service + _tax - _discount
  where id = _bill_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('coupon', _c.code, 'type', _c.type, 'value', _c.value));
  return _subtotal + _service + _tax - _discount;
end $$;

-- Rewire recompute_bill's discount term to the shared calc (keeps item + coupon
-- rows). Body otherwise unchanged.
create or replace function public.recompute_bill(_bill_id uuid)
returns void language plpgsql set search_path = public
as $$
declare
  _tenant uuid; _otype public.order_type; _subtotal integer := 0;
  _service_pct numeric := 0; _packaging numeric := 0; _tax_rules jsonb := '[]';
  _service_cents integer := 0; _packaging_cents integer := 0; _tax_cents integer := 0; _discount integer := 0;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then return; end if;

  select coalesce(sum(oi.unit_price_cents * oi.qty), 0) into _subtotal
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;

  select order_type into _otype from public.orders where bill_id = _bill_id limit 1;
  select service_charge, packaging_fee, tax_rules into _service_pct, _packaging, _tax_rules
  from public.tenant_settings where tenant_id = _tenant;

  _service_cents := round(_subtotal * coalesce(_service_pct, 0) / 100.0);
  if _otype in ('pickup', 'delivery') then
    _packaging_cents := round(coalesce(_packaging, 0) * 100);
  end if;
  select coalesce(sum(round((_subtotal + _service_cents) * (r->>'rate')::numeric / 100.0)), 0) into _tax_cents
  from jsonb_array_elements(coalesce(_tax_rules, '[]')) r
  where coalesce((r->>'inclusive')::boolean, false) = false;

  _discount := least(public.bill_discount_total(_bill_id, _subtotal),
                     _subtotal + _service_cents + _packaging_cents + _tax_cents);

  update public.bills
  set subtotal_cents = _subtotal,
      service_charge_cents = _service_cents + _packaging_cents,
      tax_cents = _tax_cents,
      discount_cents = _discount,
      total_cents = _subtotal + _service_cents + _packaging_cents + _tax_cents - _discount
  where id = _bill_id;

  delete from public.bill_items where bill_id = _bill_id;
  insert into public.bill_items (tenant_id, bill_id, order_item_id, description, qty, unit_price_cents, tax_cents, total_cents)
  select _tenant, _bill_id, oi.id, oi.name_snapshot, oi.qty, oi.unit_price_cents, 0, oi.unit_price_cents * oi.qty
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.bill_id = _bill_id and oi.is_void = false;
end $$;

revoke execute on function public.recompute_bill(uuid) from anon, authenticated, public;
revoke execute on function public.apply_item_discount(uuid, public.discount_type, numeric, text) from anon, public;
revoke execute on function public.apply_coupon(uuid, text) from anon, public;
grant execute on function public.apply_item_discount(uuid, public.discount_type, numeric, text) to authenticated;
grant execute on function public.apply_coupon(uuid, text) to authenticated;
