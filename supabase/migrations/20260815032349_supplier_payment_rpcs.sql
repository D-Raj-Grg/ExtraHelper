-- ============================================================================
-- Supplier payments.
--
-- Receiving a PO moves stock and says nothing about money. Deliveries commonly
-- arrive on credit, so receipt and payment are separate events and the balance
-- is derived, never stored — a stored balance is a second source of truth that
-- drifts away from the rows it claims to summarise.
--
-- A cash-method payment writes BOTH the supplier_payments row and its
-- cash_movements payout, inside one function and therefore one transaction. A
-- half-written pair would either overstate a supplier balance or hide cash
-- leaving the drawer, and both are worse than a clean refusal.
--
-- _po_id is nullable on purpose: it carries the "quick purchase" case, where a
-- receipt is one total for several goods and there is no honest per-item split
-- to put on PO lines.
-- ============================================================================

create or replace function public.record_supplier_payment(
  _supplier_id  uuid,
  _po_id        uuid,
  _amount_cents integer,
  _method       public.payment_method,
  _paid_at      timestamptz default null,
  _note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _uid uuid := auth.uid();
  _tenant uuid; _branch uuid; _session uuid; _id uuid; _clean_note text;
begin
  select tenant_id into _tenant from public.suppliers where id = _supplier_id;
  if _tenant is null then
    raise exception 'supplier not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'purchasing.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if _po_id is not null and not exists (
    select 1 from public.purchase_orders where id = _po_id and tenant_id = _tenant
  ) then
    raise exception 'purchase order does not belong to this tenant' using errcode = '42501';
  end if;

  _clean_note := nullif(btrim(coalesce(_note, '')), '');
  select branch_id into _branch from public.purchase_orders where id = _po_id;

  -- Cash leaves a physical drawer. If none is open there is nothing to take it
  -- from, and inventing a movement against an unrelated later session would
  -- corrupt that shift's count. Pay from outside cash and record it as 'other'.
  if _method = 'cash' then
    select id into _session
    from public.cash_sessions
    where cashier_id = _uid and status = 'open'
    order by opened_at desc
    limit 1;
    if _session is null then
      raise exception 'no open cash session — open the drawer, or record this as a non-cash payment'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.supplier_payments
    (tenant_id, branch_id, supplier_id, po_id, amount_cents, method, paid_at, note, created_by)
  values (_tenant, _branch, _supplier_id, _po_id, _amount_cents, _method,
          coalesce(_paid_at, now()), _clean_note, _uid)
  returning id into _id;

  if _method = 'cash' then
    insert into public.cash_movements
      (tenant_id, branch_id, session_id, kind, category, amount_cents, note,
       supplier_payment_id, created_by)
    values (_tenant, _branch, _session, 'payout', 'supplier', _amount_cents,
            coalesce(_clean_note,
                     'Supplier payment — ' || (select name from public.suppliers where id = _supplier_id)),
            _id, _uid);
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, _uid, 'supplier_payment', 'supplier', _supplier_id,
          jsonb_build_object('payment_id', _id, 'amount_cents', _amount_cents,
                             'method', _method, 'po_id', _po_id));

  return _id;
end $$;

-- Received value, not ordered value: you owe for what actually arrived.
create or replace function public.supplier_balances()
returns table (
  supplier_id       uuid,
  supplier_name     text,
  received_cents    bigint,
  paid_cents        bigint,
  outstanding_cents bigint
)
language sql
stable
security definer
set search_path = 'public'
as $$
  with mine as (
    select s.id, s.name
    from public.suppliers s
    where public.has_permission(s.tenant_id, 'purchasing.view')
  ),
  received as (
    select po.supplier_id, sum(pi.qty_received * pi.unit_cost_cents)::bigint as cents
    from public.purchase_orders po
    join public.po_items pi on pi.po_id = po.id
    where po.supplier_id is not null and po.status <> 'cancelled'
    group by po.supplier_id
  ),
  paid as (
    select sp.supplier_id, sum(sp.amount_cents)::bigint as cents
    from public.supplier_payments sp
    group by sp.supplier_id
  )
  select m.id, m.name,
         coalesce(r.cents, 0),
         coalesce(p.cents, 0),
         coalesce(r.cents, 0) - coalesce(p.cents, 0)
  from mine m
  left join received r on r.supplier_id = m.id
  left join paid p on p.supplier_id = m.id
  order by (coalesce(r.cents, 0) - coalesce(p.cents, 0)) desc, m.name;
$$;

revoke execute on function public.record_supplier_payment(uuid, uuid, integer, public.payment_method, timestamptz, text) from anon, public;
grant  execute on function public.record_supplier_payment(uuid, uuid, integer, public.payment_method, timestamptz, text) to authenticated;
revoke execute on function public.supplier_balances() from anon, public;
grant  execute on function public.supplier_balances() to authenticated;
