-- ============================================================================
-- close_cash_session, with the other side of the ledger.
--
-- Before: expected = float + cash sales. Anything that left the drawer read as
-- a shortfall. Now payouts and cash refunds come off, and paid-in goes on.
--
-- Pending movements are auto-approved here rather than blocking the close: a
-- cashier should not be stranded at 11pm waiting for an owner to open their
-- phone. The trade-off is real and deliberate — approval is a review step, not
-- a hard control — and auto_approved is set true so the shift report can mark
-- those rows and an owner can scan for them.
--
-- Because the close resolves everything pending, a closed session is final. No
-- closed session ever needs its expected or variance recomputed.
--
-- Same arity as the previous version, so `create or replace` is safe and the
-- existing grants still apply.
-- ============================================================================

create or replace function public.close_cash_session(
  _session_id uuid,
  _counted_cents integer
)
returns table (expected_cents integer, counted_cents integer, variance_cents integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _branch uuid;
  _opened timestamptz;
  _float  integer;
  _status public.cash_session_status;
  _cash_sales   integer := 0;
  _cash_refunds integer := 0;
  _payouts      integer := 0;
  _paid_in      integer := 0;
  _expected integer;
  _variance integer;
begin
  select tenant_id, branch_id, opened_at, opening_float_cents, status
    into _tenant, _branch, _opened, _float, _status
  from public.cash_sessions where id = _session_id;
  if _tenant is null then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _status = 'closed' then
    raise exception 'session already closed' using errcode = '22023';
  end if;
  if _counted_cents < 0 then
    raise exception 'counted amount cannot be negative' using errcode = '22023';
  end if;

  -- Resolve every pending movement first, so the sums below see a settled set.
  update public.cash_movements
  set status = 'approved', auto_approved = true,
      approved_by = auth.uid(), approved_at = now()
  where session_id = _session_id and status = 'pending';

  -- Cash payments taken during the session (branch-scoped when set).
  select coalesce(sum(p.amount_cents), 0) into _cash_sales
  from public.payments p
  join public.bills b on b.id = p.bill_id
  where p.tenant_id = _tenant
    and p.method = 'cash'
    and p.status = 'completed'
    and p.created_at >= _opened
    and (_branch is null or b.branch_id = _branch);

  -- Cash handed back. method is null on pre-migration rows and on split-tender
  -- bills; null is NOT cash, so an unknown can never move the variance.
  select coalesce(sum(r.amount_cents), 0) into _cash_refunds
  from public.refunds r
  left join public.bills b on b.id = r.bill_id
  where r.tenant_id = _tenant
    and r.method = 'cash'
    and r.created_at >= _opened
    and (_branch is null or b.branch_id is null or b.branch_id = _branch);

  select
    coalesce(sum(amount_cents) filter (where kind = 'payout'), 0),
    coalesce(sum(amount_cents) filter (where kind = 'paid_in'), 0)
  into _payouts, _paid_in
  from public.cash_movements
  where session_id = _session_id and status = 'approved';

  _expected := _float + _cash_sales - _cash_refunds - _payouts + _paid_in;
  _variance := _counted_cents - _expected;

  update public.cash_sessions
  set expected_cents = _expected,
      counted_cents = _counted_cents,
      variance_cents = _variance,
      status = 'closed',
      closed_at = now()
  where id = _session_id;

  return query select _expected, _counted_cents, _variance;
end $$;
