-- ============================================================================
-- Supplier delete, payment voiding, and the purchasing summary.
-- ============================================================================

/**
 * Delete a supplier — only one you never actually used.
 *
 * supplier_payments.supplier_id is NOT NULL ON DELETE RESTRICT, so the database
 * would refuse a paid supplier anyway, with a message nobody can read. We
 * refuse first, in words, naming the count.
 *
 * purchase_orders.supplier_id is ON DELETE SET NULL, so the database would
 * happily let the delete through and quietly reparent every past order to
 * "No supplier". That is history laundering, so we refuse that too. Archive is
 * the answer for anyone you have actually bought from.
 *
 * inventory_items.supplier_id SET NULL is allowed through: a reorder hint is
 * not history.
 */
create or replace function public.delete_supplier(_supplier_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _name text; _archived timestamptz; _pays int; _pos int;
begin
  select tenant_id, name, archived_at into _tenant, _name, _archived
  from public.suppliers where id = _supplier_id;
  if _tenant is null then return; end if;   -- deleting twice is not an error
  perform public.assert_may_delete_purchasing(_tenant);

  if _archived is null then
    raise exception 'archive % first — deleting is for suppliers you never used', _name
      using errcode = '22023';
  end if;

  select count(*) into _pays from public.supplier_payments where supplier_id = _supplier_id;
  if _pays > 0 then
    raise exception '% payments are recorded against % — archive them instead', _pays, _name
      using errcode = '23503';
  end if;
  select count(*) into _pos from public.purchase_orders where supplier_id = _supplier_id;
  if _pos > 0 then
    raise exception '% purchase orders name % — archive them instead', _pos, _name
      using errcode = '23503';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'supplier_deleted', 'supplier', _supplier_id,
          jsonb_build_object('name', _name));
  delete from public.suppliers where id = _supplier_id;
end $$;

/**
 * Void a supplier payment. Never delete, never negate: amount_cents is
 * check (> 0) so a reversing row is impossible, and a deleted payment is a hole
 * in a reconciliation.
 *
 * The hard part is the cash leg. A cash payment wrote a cash_movements payout
 * in the same transaction. If that movement's session is still open we reject
 * the movement so expected recomputes at close. If the session is already
 * closed its expected and variance are frozen, and silently rewriting a shift
 * that someone counted and signed off is worse than making them record a
 * correcting cash-in today. So we refuse, and say why.
 */
create or replace function public.void_supplier_payment(_payment_id uuid, _reason text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare _tenant uuid; _voided timestamptz; _mv uuid; _sess_status public.cash_session_status;
begin
  select sp.tenant_id, sp.voided_at into _tenant, _voided
  from public.supplier_payments sp where sp.id = _payment_id;
  if _tenant is null then raise exception 'payment not found' using errcode = 'P0002'; end if;
  perform public.assert_may_delete_purchasing(_tenant);

  if _voided is not null then
    raise exception 'that payment is already voided' using errcode = '22023';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'say why — a void without a reason cannot be audited' using errcode = '22023';
  end if;

  select cm.id, s.status into _mv, _sess_status
  from public.cash_movements cm
  join public.cash_sessions s on s.id = cm.session_id
  where cm.supplier_payment_id = _payment_id and cm.status <> 'rejected'
  limit 1;

  if _mv is not null and _sess_status = 'closed' then
    raise exception 'that payment came out of a shift that has already been closed and counted — record a correcting cash-in on today''s drawer instead'
      using errcode = '22023';
  end if;

  if _mv is not null then
    update public.cash_movements
    set status = 'rejected', approved_by = auth.uid(), approved_at = now()
    where id = _mv;
  end if;

  update public.supplier_payments
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(_reason)
  where id = _payment_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'supplier_payment_voided', 'supplier', _payment_id,
          jsonb_build_object('reason', btrim(_reason), 'cash_movement', _mv));
end $$;

-- Balances v2: voided payments stop counting, and archived suppliers keep
-- appearing. Archiving hides someone from a picker; it must never hide a debt.
--
-- Return type gains archived_at, so drop first: `create or replace` cannot
-- change the row type defined by OUT parameters, the same way it cannot change
-- arity. Grants are re-issued below naming the signature.
drop function if exists public.supplier_balances();

create function public.supplier_balances()
returns table (
  supplier_id       uuid,
  supplier_name     text,
  received_cents    bigint,
  paid_cents        bigint,
  outstanding_cents bigint,
  archived_at       timestamptz
)
language sql stable security definer set search_path = 'public' as $$
  with mine as (
    select s.id, s.name, s.archived_at
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
    where sp.voided_at is null
    group by sp.supplier_id
  )
  select m.id, m.name,
         coalesce(r.cents, 0),
         coalesce(p.cents, 0),
         coalesce(r.cents, 0) - coalesce(p.cents, 0),
         m.archived_at
  from mine m
  left join received r on r.supplier_id = m.id
  left join paid p on p.supplier_id = m.id
  order by (coalesce(r.cents, 0) - coalesce(p.cents, 0)) desc, m.name;
$$;

/**
 * The three numbers on the purchasing summary strip.
 *
 * A function, not three client queries, because "this month" is a
 * tenant-timezone question and now() on the server answers it in the server's
 * zone.
 */
create or replace function public.purchasing_summary(_tenant uuid)
returns table (
  owed_cents        bigint,
  owed_suppliers    integer,
  open_pos          integer,
  awaiting_delivery integer,
  month_spend_cents bigint,
  month_start       timestamptz
)
language plpgsql stable security definer set search_path = 'public' as $$
declare _z text; _ms timestamptz;
begin
  if not public.has_permission(_tenant, 'purchasing.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select coalesce(ts.timezone, 'UTC') into _z
  from public.tenant_settings ts where ts.tenant_id = _tenant;
  _z := coalesce(_z, 'UTC');
  _ms := (date_trunc('month', (now() at time zone _z)) at time zone _z);

  return query
  select
    coalesce((select sum(b.outstanding_cents) from public.supplier_balances() b
               where b.outstanding_cents > 0), 0)::bigint,
    (select count(*) from public.supplier_balances() b where b.outstanding_cents > 0)::integer,
    (select count(*) from public.purchase_orders
      where tenant_id = _tenant and status in ('draft','sent','partial'))::integer,
    (select count(*) from public.purchase_orders
      where tenant_id = _tenant and status in ('sent','partial'))::integer,
    (select coalesce(sum(amount_cents), 0) from public.supplier_payments
      where tenant_id = _tenant and paid_at >= _ms and voided_at is null)::bigint,
    _ms;
end $$;

revoke execute on function public.delete_supplier(uuid) from anon, public;
grant  execute on function public.delete_supplier(uuid) to authenticated;
revoke execute on function public.void_supplier_payment(uuid, text) from anon, public;
grant  execute on function public.void_supplier_payment(uuid, text) to authenticated;
revoke execute on function public.supplier_balances() from anon, public;
grant  execute on function public.supplier_balances() to authenticated;
revoke execute on function public.purchasing_summary(uuid) from anon, public;
grant  execute on function public.purchasing_summary(uuid) to authenticated;
