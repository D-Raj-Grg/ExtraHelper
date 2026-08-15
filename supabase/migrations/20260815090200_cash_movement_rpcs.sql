-- ============================================================================
-- Movement RPCs.
--
-- Recording reuses cash.manage, which the cashier role already holds. Approval
-- uses cash.approve, which it deliberately does not — see the previous
-- migration.
--
-- The caller's own open session is the only drawer they can move cash in, so
-- none of these take a session id: passing one would just be an opportunity to
-- pass the wrong one.
-- ============================================================================

create or replace function public.record_cash_movement(
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
  _session uuid; _tenant uuid; _branch uuid; _id uuid;
begin
  select id, tenant_id, branch_id into _session, _tenant, _branch
  from public.cash_sessions
  where cashier_id = _uid and status = 'open'
  order by opened_at desc
  limit 1;

  if _session is null then
    raise exception 'no open cash session — open the drawer first' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'cash.manage') then
    raise exception 'permission denied' using errcode = '42501';
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

-- Shared body for approve/reject: both are the same transition with a different
-- target state, and splitting the checks between two functions is how they drift.
create or replace function public.set_cash_movement_status(
  _id uuid,
  _to public.cash_movement_status
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare _tenant uuid; _session uuid; _session_status public.cash_session_status;
begin
  select m.tenant_id, m.session_id, s.status
    into _tenant, _session, _session_status
  from public.cash_movements m
  join public.cash_sessions s on s.id = m.session_id
  where m.id = _id;

  if _tenant is null then
    raise exception 'movement not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'cash.approve') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  -- A closed session is final: its expected and variance are already written,
  -- and letting a status change afterwards would silently invalidate them.
  if _session_status = 'closed' then
    raise exception 'session already closed' using errcode = '22023';
  end if;

  update public.cash_movements
  set status = _to, approved_by = auth.uid(), approved_at = now(), auto_approved = false
  where id = _id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cash_movement_' || _to::text, 'cash_session', _session,
          jsonb_build_object('movement_id', _id));
end $$;

create or replace function public.approve_cash_movement(_id uuid)
returns void language sql security definer set search_path = 'public'
as $$ select public.set_cash_movement_status(_id, 'approved'::public.cash_movement_status); $$;

create or replace function public.reject_cash_movement(_id uuid)
returns void language sql security definer set search_path = 'public'
as $$ select public.set_cash_movement_status(_id, 'rejected'::public.cash_movement_status); $$;

revoke execute on function public.record_cash_movement(public.cash_movement_kind, public.cash_movement_category, integer, text) from anon, public;
grant  execute on function public.record_cash_movement(public.cash_movement_kind, public.cash_movement_category, integer, text) to authenticated;
-- Not callable directly: approve/reject are the entry points, and this one takes
-- the target state as an argument.
revoke execute on function public.set_cash_movement_status(uuid, public.cash_movement_status) from anon, public, authenticated;
revoke execute on function public.approve_cash_movement(uuid) from anon, public;
grant  execute on function public.approve_cash_movement(uuid) to authenticated;
revoke execute on function public.reject_cash_movement(uuid) from anon, public;
grant  execute on function public.reject_cash_movement(uuid) to authenticated;
