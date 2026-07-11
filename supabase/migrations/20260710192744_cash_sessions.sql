-- ============================================================================
-- Cash drawer / day-close. Open a session (opening float), close it with a
-- counted amount; expected = float + cash payments during the session, variance
-- = counted − expected. Trusted SQL (SECURITY DEFINER), cashier/manager/owner.
-- ============================================================================

-- Open (or return the existing open) cash session for the caller.
create or replace function public.open_cash_session(
  _tenant uuid,
  _branch_id uuid,
  _opening_float_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _existing uuid;
  _session uuid;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _opening_float_cents < 0 then
    raise exception 'opening float cannot be negative' using errcode = '22023';
  end if;

  -- One open session per cashier per tenant.
  select id into _existing from public.cash_sessions
  where tenant_id = _tenant and cashier_id = _uid and status = 'open'
  limit 1;
  if _existing is not null then
    return _existing;
  end if;

  insert into public.cash_sessions (tenant_id, branch_id, cashier_id, status, opening_float_cents)
  values (_tenant, _branch_id, _uid, 'open', _opening_float_cents)
  returning id into _session;
  return _session;
end $$;

-- Close a session: reconcile counted vs expected cash.
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
  _cash_sales integer := 0;
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

  -- Cash payments taken during the session (branch-scoped when set).
  select coalesce(sum(p.amount_cents), 0) into _cash_sales
  from public.payments p
  join public.bills b on b.id = p.bill_id
  where p.tenant_id = _tenant
    and p.method = 'cash'
    and p.status = 'completed'
    and p.created_at >= _opened
    and (_branch is null or b.branch_id = _branch);

  _expected := _float + _cash_sales;
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

revoke execute on function public.open_cash_session(uuid, uuid, integer) from anon, public;
grant execute on function public.open_cash_session(uuid, uuid, integer) to authenticated;
revoke execute on function public.close_cash_session(uuid, integer) from anon, public;
grant execute on function public.close_cash_session(uuid, integer) to authenticated;
