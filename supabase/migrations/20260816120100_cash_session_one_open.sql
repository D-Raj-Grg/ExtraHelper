-- ============================================================================
-- One open drawer per restaurant (per branch), enforced by the database.
--
-- Two defects share one root. `open_cash_session` picks its session with a
-- select-then-insert, no lock and no constraint behind it, so two taps race.
-- And `close_cash_session` counts cash sales with `created_at >= opened_at`
-- and NO upper bound, so where two sessions are open at once they each claim
-- the same sales and both reconcile against money the other also counted.
--
-- Fixing the window alone is not enough: the real invariant the reconciliation
-- assumes is that at any instant there is exactly one drawer to attribute a
-- cash sale to. That is now a unique index, so the overlap is unreachable
-- rather than merely unlikely.
--
-- Scoped to (tenant, branch) rather than (tenant, cashier). Cash sales are
-- about to auto-open a drawer, and a per-cashier scope would mint one open
-- session per person on a busy evening — the overlap defect, multiplied.
-- `cashier_id` therefore stops meaning "whose drawer" and starts meaning "who
-- opened it", and is null on a drawer nobody opened by hand.
--
-- `branch_key` exists because `on conflict` inference against a partial index
-- on a bare `coalesce(...)` expression is fragile; a stored generated column
-- makes the inference clause trivial and the index cheap.
-- ============================================================================

alter table public.cash_sessions
  add column if not exists branch_key uuid
    generated always as (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  add column if not exists auto_opened boolean not null default false;

comment on column public.cash_sessions.auto_opened is
  'True when the first cash activity of the day opened this drawer, rather than a person. Such a session has no cashier_id until someone adopts it via open_cash_session.';

-- Normalise any pre-existing overlap before the index refuses to build. Keep
-- the earliest-opened drawer per (tenant, branch); re-point the others'
-- movements onto it — same tenant, so cash_movements_tenant_guard passes —
-- then close them.
--
-- `counted_cents` stays NULL on the losers, deliberately: those drawers were
-- never physically counted, and inventing a figure would fabricate a count
-- that never happened. A null count is the honest record of "nobody counted".
do $$
declare _r record;
begin
  for _r in
    select tenant_id,
           coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) as bkey,
           (array_agg(id order by opened_at))[1] as keeper,
           array_agg(id order by opened_at) as all_ids
    from public.cash_sessions
    where status = 'open'
    group by 1, 2
    having count(*) > 1
  loop
    update public.cash_movements
       set session_id = _r.keeper
     where session_id = any(_r.all_ids) and session_id <> _r.keeper;

    update public.cash_sessions
       set status = 'closed',
           closed_at = now(),
           expected_cents = 0,
           counted_cents = null,
           variance_cents = null
     where id = any(_r.all_ids) and id <> _r.keeper;
  end loop;
end $$;

create unique index if not exists cash_sessions_one_open
  on public.cash_sessions (tenant_id, branch_key)
  where status = 'open';
