-- ============================================================================
-- Bill-level discounts (trusted). %/flat, recomputed in SQL, gated to
-- owner/manager (manager approval, rule: sensitive), and audited (rule #5).
-- Discount comes off the total (after service + tax); total floored at 0.
-- ============================================================================

create or replace function public.apply_bill_discount(
  _bill_id uuid,
  _type    public.discount_type,
  _value   numeric,
  _reason  text default null
)
returns integer                       -- new total_cents
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant   uuid;
  _subtotal integer;
  _service  integer;
  _tax      integer;
  _discount integer := 0;
begin
  select tenant_id, subtotal_cents, service_charge_cents, tax_cents
    into _tenant, _subtotal, _service, _tax
  from public.bills where id = _bill_id;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;

  -- Manager approval: only owner/manager may discount.
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'discounts require a manager' using errcode = '42501';
  end if;
  if _value <= 0 then
    raise exception 'discount must be positive' using errcode = '22023';
  end if;
  if _type = 'percent' and _value > 100 then
    raise exception 'percent discount cannot exceed 100' using errcode = '22023';
  end if;

  insert into public.discounts (tenant_id, bill_id, type, value, reason, approved_by)
  values (_tenant, _bill_id, _type, _value, _reason, auth.uid());

  -- Recompute total discount from all bill-level discount rows.
  select coalesce(sum(
           case when d.type = 'percent'
                then round(_subtotal * d.value / 100.0)
                else round(d.value * 100) end
         ), 0)
    into _discount
  from public.discounts d
  where d.bill_id = _bill_id and d.bill_id is not null;

  _discount := least(_discount, _subtotal + _service + _tax);  -- never below 0

  update public.bills
  set discount_cents = _discount,
      total_cents = _subtotal + _service + _tax - _discount
  where id = _bill_id;

  -- Audit the sensitive action.
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'discount', 'bill', _bill_id,
          jsonb_build_object('type', _type, 'value', _value, 'reason', _reason));

  return _subtotal + _service + _tax - _discount;
end $$;

revoke execute on function public.apply_bill_discount(uuid, public.discount_type, numeric, text) from anon, public;
grant execute on function public.apply_bill_discount(uuid, public.discount_type, numeric, text) to authenticated;
