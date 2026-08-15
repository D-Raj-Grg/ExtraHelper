-- ============================================================================
-- Scope the open-session lookup to a tenant.
--
-- Both RPCs found the caller's drawer with `where cashier_id = auth.uid() and
-- status = 'open'` and no tenant filter. One open session per cashier *per
-- tenant* is allowed, so a user who belongs to two tenants can hold two open
-- drawers at once, and `order by opened_at desc limit 1` then picks whichever
-- was opened last.
--
-- In record_supplier_payment that is an isolation break, not just an ambiguity:
-- the tenant came from the supplier while the session came from anywhere, so
-- paying a tenant A supplier while holding a tenant B drawer wrote a
-- cash_movements row stamped tenant A but pointing at B's session — and
-- close_cash_session sums by session_id, so tenant B's drawer would have been
-- debited for tenant A's purchase.
--
-- record_cash_movement derived its tenant *from* the session, so its rows were
-- always self-consistent; the flaw there was silently charging the wrong
-- drawer. It now takes the tenant explicitly, because the caller always knows
-- which one it means and guessing is what caused this.
--
-- Latent when written: no user currently belongs to more than one tenant.
-- ============================================================================

-- Arity changes, so drop first: `create or replace` would leave the 4-arg body
-- live as an overload and PostgREST would resolve to whichever matched.
drop function if exists public.record_cash_movement(
  public.cash_movement_kind, public.cash_movement_category, integer, text);

create function public.record_cash_movement(
  _tenant       uuid,
  _kind         public.cash_movement_kind,
  _category     public.cash_movement_category,
  _amount_cents integer,
  _note         text
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  _uid uuid := auth.uid();
  _session uuid; _branch uuid; _id uuid;
begin
  if not public.has_permission(_tenant, 'cash.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select id, branch_id into _session, _branch
  from public.cash_sessions
  where cashier_id = _uid and status = 'open' and tenant_id = _tenant
  order by opened_at desc
  limit 1;

  if _session is null then
    raise exception 'no open cash session — open the drawer first' using errcode = 'P0002';
  end if;
  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if coalesce(btrim(_note), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if length(_note) > 280 then
    raise exception 'reason is too long' using errcode = '22001';
  end if;

  insert into public.cash_movements
    (tenant_id, branch_id, session_id, kind, category, amount_cents, note, created_by)
  values (_tenant, _branch, _session, _kind, _category, _amount_cents, btrim(_note), _uid)
  returning id into _id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, _uid, 'cash_movement', 'cash_session', _session,
          jsonb_build_object('movement_id', _id, 'kind', _kind,
                             'category', _category, 'amount_cents', _amount_cents));

  return _id;
end $$;

revoke execute on function public.record_cash_movement(uuid, public.cash_movement_kind, public.cash_movement_category, integer, text) from anon, public;
grant  execute on function public.record_cash_movement(uuid, public.cash_movement_kind, public.cash_movement_category, integer, text) to authenticated;

-- Same arity, so replace in place. The only change is the tenant filter on the
-- session lookup.
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

  -- The drawer must belong to the SAME tenant as the supplier, or the movement
  -- would debit an unrelated tenant's shift.
  if _method = 'cash' then
    select id into _session
    from public.cash_sessions
    where cashier_id = _uid and status = 'open' and tenant_id = _tenant
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

-- A cash_movements row must never point at a session belonging to a different
-- tenant. Belt and braces behind the RPCs, and the thing that would have caught
-- the bug above on the way in.
alter table public.cash_movements
  drop constraint if exists cash_movements_session_same_tenant;

create or replace function public.cash_movement_tenant_matches_session()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if not exists (
    select 1 from public.cash_sessions s
    where s.id = new.session_id and s.tenant_id = new.tenant_id
  ) then
    raise exception 'cash movement tenant does not match its session' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists cash_movements_tenant_guard on public.cash_movements;
create trigger cash_movements_tenant_guard
  before insert or update of tenant_id, session_id on public.cash_movements
  for each row execute function public.cash_movement_tenant_matches_session();
