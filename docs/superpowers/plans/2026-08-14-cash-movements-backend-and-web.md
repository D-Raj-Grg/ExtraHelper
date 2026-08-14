# Cash Movements & Supplier Payments — Backend + Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cash drawer account for every rupee that leaves it, and track what is owed to suppliers, so a non-zero variance means a real discrepancy.

**Architecture:** Two new tables — `cash_movements` (physical drawer cash only) and `supplier_payments` (money owed/paid to a supplier by any method). All writes go through SECURITY DEFINER RPCs; RLS grants select only. `close_cash_session` is rewritten to auto-approve pending movements and then subtract payouts and cash refunds from expected.

**Tech Stack:** Supabase Postgres (SQL migrations, plpgsql RPCs, RLS), Next.js App Router (Server Actions, RSC), shadcn/base-ui components, bash + curl integration suites over live PostgREST.

**Spec:** `docs/superpowers/specs/2026-08-14-cash-movements-and-supplier-payments-design.md` — read it before starting. This plan implements it and does not restate its reasoning.

## Global Constraints

- **Tenant isolation is non-negotiable.** Every new table has `tenant_id` and an RLS policy added in the same migration. Never trust a client-side role check.
- **`create or replace function` cannot change arity.** Changing an RPC's argument list means `drop function if exists ...` then `create function`, then re-issuing `revoke ... from anon, public` and `grant ... to authenticated` **naming the full new signature**. Old grants do not carry over and `public` holds EXECUTE by default.
- **Money is integer cents.** Never floats. Format for display via `money()` from `@/lib/format`; never hand-rolled `toFixed`.
- **Currency and timezone come from tenant settings**, never hardcoded.
- **The open-session UI must never display expected, cash sales, or anything derived from them.** See spec, "UI". Showing movement amounts is fine.
- **Migration timestamps must sort after `20260814180000`** (the digital-payment-methods migration), because `supplier_payments.method` uses the `payment_method` enum values it adds.
- **Design system:** `Card`, `Badge`, `Table` + `TableHeader` (every column gets a header), `Field`/`FieldLabel` with `htmlFor`, lucide icons only, tap targets ≥44px, `tabular-nums` on every figure in a column with numeric columns right-aligned, semantic colour tokens (`emerald` good, `amber` warning, `destructive` short/loss) never colour alone. See `CLAUDE.md`.
- **Never fire-and-forget a Server Action** — always surface `{error}`.
- **Commit after every task.**

## Environment for the test suites

The bash suites need these in the environment. They are real accounts; never hardcode them (this repo is public):

```bash
export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
export DEMO_WAITER_EMAIL=... DEMO_WAITER_PASSWORD=...
export DEMO_CASHIER_EMAIL=... DEMO_CASHIER_PASSWORD=...
export TENANT=<tenant uuid> SERVICE_KEY=<service role key>
```

`SUPABASE_URL` and the publishable key are read from `../../../extrahelper_flutter/env.json` by the scripts themselves.

`DEMO_CASHIER_*` must be a real user in `TENANT` whose role is **cashier** — the suite's whole point is that a cashier can record and cannot approve, so an owner account in that variable makes the tests pass while proving nothing. If no such account exists, create one before Task 1: add the user in Supabase Auth, then insert a `user_tenants` row for `TENANT` pointing at that tenant's system Cashier role. Delete it when the work is done, and never commit the credentials.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `supabase/migrations/20260815090000_cash_movements_tables.sql` | Enums, `supplier_payments`, `cash_movements`, indexes, RLS |
| `supabase/migrations/20260815090100_refunds_method.sql` | `refunds.method` column, backfill, new `refund_payment` |
| `supabase/migrations/20260815090200_cash_movement_rpcs.sql` | `record_cash_movement`, `approve_cash_movement`, `reject_cash_movement` |
| `supabase/migrations/20260815090300_close_cash_session_v2.sql` | Rewritten `close_cash_session` |
| `supabase/migrations/20260815090400_supplier_payment_rpcs.sql` | `record_supplier_payment`, `supplier_balances` |
| `supabase/migrations/20260815090500_cash_approve_permission.sql` | `cash.approve` key + backfill; drops `purchase_orders.total_cents` |
| `supabase/tests/cash_guards.sh` | Permission/RLS/atomicity assertions |
| `supabase/tests/cash_expected_math.sh` | The reconciliation acceptance test |
| `components/cash/movements-panel.tsx` | Movement list + approve/reject controls |
| `components/cash/movement-dialog.tsx` | Cash out / Cash in entry form |
| `components/purchasing/payment-dialog.tsx` | Record supplier payment form |
| `components/purchasing/payables.tsx` | Outstanding-per-supplier block |

**Modified:**

| File | Change |
|---|---|
| `components/cash/types.ts` | Add `CashMovement`, extend `OpenSession` |
| `app/(app)/cash/actions.ts` | Add movement server actions |
| `app/(app)/cash/page.tsx` | Load movements, pass `canApprove` |
| `components/cash/session-card.tsx` | Render panel; pending-count warning on close |
| `components/cash/shift-reports.tsx` | Expandable breakdown, auto-approved marker |
| `app/(app)/purchasing/actions.ts` | Add `recordSupplierPayment` |
| `app/(app)/purchasing/page.tsx` | Load balances |
| `components/purchasing-manager.tsx` | Payment action on `POCard`, payables block |
| `lib/supabase/database.types.ts` | Regenerate |

---

### Task 1: Tables, enums, RLS

**Files:**
- Create: `supabase/migrations/20260815090000_cash_movements_tables.sql`
- Create: `supabase/tests/cash_guards.sh`

**Interfaces:**
- Consumes: existing `tenants`, `branches`, `cash_sessions`, `suppliers`, `purchase_orders`, `public.payment_method` enum.
- Produces: tables `public.cash_movements`, `public.supplier_payments`; enums `cash_movement_kind`, `cash_movement_status`, `cash_movement_category`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/cash_guards.sh`. This is the suite later tasks extend; it starts by asserting the tables exist and refuse direct writes.

```bash
#!/usr/bin/env bash
# Cash movements are a boundary, not a hidden button — driven over real
# PostgREST as the roles that actually make these calls.
#
# Credentials come from the environment — never hardcode them here. This repo is
# public, and these accounts are real.
#
#   export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
#   export DEMO_WAITER_EMAIL=... DEMO_WAITER_PASSWORD=...
#   export DEMO_CASHIER_EMAIL=... DEMO_CASHIER_PASSWORD=...
#   TENANT=<tenant uuid> SERVICE_KEY=<service role key> ./cash_guards.sh
set -uo pipefail
cd "$(dirname "$0")/../../../extrahelper_flutter"

URL=$(python3 -c "import json;print(json.load(open('env.json'))['SUPABASE_URL'])")
KEY=$(python3 -c "import json;d=json.load(open('env.json'));print(d.get('SUPABASE_PUBLISHABLE_KEY') or d.get('SUPABASE_ANON_KEY'))")

OWNER_EMAIL="${DEMO_OWNER_EMAIL:?set DEMO_OWNER_EMAIL}"
OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:?set DEMO_OWNER_PASSWORD}"
WAITER_EMAIL="${DEMO_WAITER_EMAIL:?set DEMO_WAITER_EMAIL}"
WAITER_PASSWORD="${DEMO_WAITER_PASSWORD:?set DEMO_WAITER_PASSWORD}"
CASHIER_EMAIL="${DEMO_CASHIER_EMAIL:?set DEMO_CASHIER_EMAIL}"
CASHIER_PASSWORD="${DEMO_CASHIER_PASSWORD:?set DEMO_CASHIER_PASSWORD}"
TENANT="${TENANT:?set TENANT}"
SERVICE_KEY="${SERVICE_KEY:?set SERVICE_KEY}"

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")
CASHIER=$(login "$CASHIER_EMAIL" "$CASHIER_PASSWORD")
[ -n "$OWNER" ]   || { echo "owner login failed"; exit 1; }
[ -n "$WAITER" ]  || { echo "waiter login failed"; exit 1; }
[ -n "$CASHIER" ] || { echo "cashier login failed"; exit 1; }
PASS=0; FAIL=0

# Bodies are built into a variable first: written inline inside an already-quoted
# argument the backslashes reach curl literally and PostgREST answers PGRST102
# instead of the guard's own SQLSTATE.
auth_rpc()  { curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
auth_post() { curl -s -X POST "$URL/rest/v1/$2" -H "apikey: $KEY" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" -d "$3"; }
auth_get()  { curl -s "$URL/rest/v1/$2" -H "apikey: $KEY" -H "Authorization: Bearer $1"; }
svc()       { curl -s "$URL/rest/v1/$1" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"; }

ok()   { PASS=$((PASS+1)); echo "  ok   — $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL — $1: $2"; }
check() { # check <label> <expected substring> <actual>
  case "$3" in *"$2"*) ok "$1";; *) bad "$1" "$3";; esac
}
# A void RPC answers with an empty body, which is a pass, not a parse error.
jqf() { python3 -c "
import json,sys
raw = sys.stdin.read().strip()
d = json.loads(raw) if raw else {}
print(d.get('$1','') if isinstance(d, dict) else '')
"; }

echo "== tables reject direct writes =="

BODY=$(printf '{"tenant_id":"%s","session_id":"%s","kind":"payout","category":"other","amount_cents":100,"note":"direct insert"}' "$TENANT" "00000000-0000-0000-0000-000000000000")
OUT=$(auth_post "$WAITER" "cash_movements" "$BODY")
check "waiter cannot insert cash_movements directly" "42501" "$OUT"

OUT=$(auth_post "$CASHIER" "cash_movements" "$BODY")
check "cashier cannot insert cash_movements directly" "42501" "$OUT"

OUT=$(auth_post "$OWNER" "cash_movements" "$BODY")
check "owner cannot insert cash_movements directly" "42501" "$OUT"

BODY=$(printf '{"tenant_id":"%s","supplier_id":"%s","amount_cents":100,"method":"cash"}' "$TENANT" "00000000-0000-0000-0000-000000000000")
OUT=$(auth_post "$OWNER" "supplier_payments" "$BODY")
check "owner cannot insert supplier_payments directly" "42501" "$OUT"

echo "== members can read =="
OUT=$(auth_get "$CASHIER" "cash_movements?select=id&limit=1")
case "$OUT" in \[*) ok "cashier can select cash_movements";; *) bad "cashier can select cash_movements" "$OUT";; esac

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to verify it fails**

```bash
chmod +x supabase/tests/cash_guards.sh && ./supabase/tests/cash_guards.sh
```

Expected: FAIL. PostgREST answers `PGRST205` / "Could not find the table 'public.cash_movements'" because the tables do not exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090000_cash_movements_tables.sql`:

```sql
-- ============================================================================
-- Cash movements + supplier payments.
--
-- close_cash_session only ever ADDED cash sales to the float, so every rupee
-- that left the drawer — a supplier paid in cash, a bundle of lemons — read as
-- a shortfall with no explanation. cash_movements is the missing side of that
-- ledger and means strictly ONE thing: physical cash in or out of the POS
-- drawer. Money paid to a supplier by any other method is a supplier_payments
-- row and nothing else; a table named for cash must never hold non-cash rows,
-- or every later query needs a filter it can silently omit.
--
-- Writes go through SECURITY DEFINER RPCs (next migration). RLS grants select
-- only — the same split the menu write guards use.
-- ============================================================================

do $$ begin
  create type public.cash_movement_kind as enum ('payout', 'paid_in');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_movement_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cash_movement_category as enum
    ('supplier', 'supplies', 'utilities', 'staff_advance', 'transport', 'other');
exception when duplicate_object then null; end $$;

-- Money paid to a supplier, by any method. Tracks credit (udhaaro): goods can
-- arrive today and be paid for next week, so receipt and payment are separate
-- events and a PO reference is optional (an on-account payment settles old
-- credit without belonging to one delivery).
create table if not exists public.supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  supplier_id  uuid not null references public.suppliers(id) on delete restrict,
  po_id        uuid references public.purchase_orders(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method       public.payment_method not null,
  paid_at      timestamptz not null default now(),
  note         text,
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

-- Physical cash in or out of the POS drawer. session_id is NOT NULL on purpose:
-- cash cannot leave a drawer that is not open, and a movement with no session
-- could never be reconciled against a count. A supplier paid at 6am before any
-- shift opens is a supplier_payments row with a non-cash method instead.
create table if not exists public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete set null,
  session_id    uuid not null references public.cash_sessions(id) on delete cascade,
  kind          public.cash_movement_kind not null,
  category      public.cash_movement_category not null,
  amount_cents  integer not null check (amount_cents > 0),
  -- A payout with no stated reason cannot be audited later, which defeats the
  -- point of recording it at all.
  note          text not null check (length(btrim(note)) > 0),
  supplier_payment_id uuid references public.supplier_payments(id) on delete set null,
  status        public.cash_movement_status not null default 'pending',
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  auto_approved boolean not null default false
);

create index if not exists idx_cash_movements_session on public.cash_movements(session_id);
create index if not exists idx_cash_movements_tenant  on public.cash_movements(tenant_id, created_at desc);
create index if not exists idx_supplier_payments_supplier on public.supplier_payments(tenant_id, supplier_id);
create index if not exists idx_supplier_payments_po on public.supplier_payments(po_id);

alter table public.cash_movements   enable row level security;
alter table public.supplier_payments enable row level security;

-- Read is open to tenant members; the drawer panel and the payables block both
-- need it. Every write path is an RPC, so there is deliberately no insert,
-- update, or delete policy on either table.
drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements
  for select to authenticated
  using (exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = cash_movements.tenant_id
      and ut.status = 'active'
  ));

drop policy if exists supplier_payments_read on public.supplier_payments;
create policy supplier_payments_read on public.supplier_payments
  for select to authenticated
  using (exists (
    select 1 from public.user_tenants ut
    where ut.user_id = auth.uid() and ut.tenant_id = supplier_payments.tenant_id
      and ut.status = 'active'
  ));

grant select on public.cash_movements   to authenticated;
grant select on public.supplier_payments to authenticated;
```

- [ ] **Step 4: Apply and re-run the test**

```bash
npx supabase db push
./supabase/tests/cash_guards.sh
```

Expected: PASS, 5 assertions green.

If `db push` reports `20260814180000_digital_payment_methods.sql` as pending, that is expected — it was applied directly and never registered. Its statements are idempotent (`add value if not exists`, `drop ... if exists`), so letting it re-run is safe.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815090000_cash_movements_tables.sql supabase/tests/cash_guards.sh
git commit -m "feat(cash): add cash_movements and supplier_payments tables

Writes go through RPCs; RLS grants select only, matching the split the
menu write guards established."
```

---

### Task 2: Refunds gain a method

**Files:**
- Create: `supabase/migrations/20260815090100_refunds_method.sql`
- Modify: `supabase/tests/cash_guards.sh` (append a section)

**Interfaces:**
- Consumes: `public.refunds`, `public.payments`, existing `refund_payment(uuid, integer, text)`.
- Produces: `refunds.method public.payment_method` (nullable); `refund_payment(_bill_id uuid, _amount_cents integer, _reason text, _method public.payment_method default null)` returning `public.bill_status`.

**Why:** `refunds` has a `payment_id` column that `refund_payment` never sets, and no method column. There is currently no way to know whether a refund went back in cash, so Task 4 cannot subtract cash refunds without this.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/cash_guards.sh`, immediately before the final `echo` / summary block:

```bash
echo "== refunds carry a method =="
OUT=$(auth_get "$OWNER" "refunds?select=id,method&limit=1")
case "$OUT" in
  *"method"*|"[]") ok "refunds exposes a method column";;
  *) bad "refunds exposes a method column" "$OUT";;
esac
```

Note: an empty result `[]` passes, because a tenant with no refunds still proves the column resolved — PostgREST answers `42703` when a selected column does not exist.

- [ ] **Step 2: Run it to verify it fails**

```bash
./supabase/tests/cash_guards.sh
```

Expected: FAIL — `column refunds.method does not exist` (`42703`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090100_refunds_method.sql`:

```sql
-- ============================================================================
-- Refunds gain a method.
--
-- refunds.payment_id has existed since the billing migration and refund_payment
-- has never written it, so a refund's tender was unrecoverable. Expected cash
-- has to subtract cash refunds, which means knowing which refunds were cash.
--
-- Backfill only where the answer is unambiguous: a bill settled entirely by one
-- method. Mixed-tender bills stay null, and null is treated as NON-cash by the
-- expected calculation — historical guesses must never move a variance figure.
-- ============================================================================

alter table public.refunds add column if not exists method public.payment_method;

update public.refunds r
set method = m.only_method
from (
  select p.bill_id, min(p.method::text)::public.payment_method as only_method
  from public.payments p
  where p.status = 'completed'
  group by p.bill_id
  having count(distinct p.method) = 1
) m
where r.bill_id = m.bill_id and r.method is null;

-- A new arg list is a new function object, so `create or replace` would leave
-- the 3-arg body live as an overload and PostgREST would resolve to whichever
-- matched. Drop first, then re-issue the grants naming the full new signature.
drop function if exists public.refund_payment(uuid, integer, text);

create function public.refund_payment(
  _bill_id      uuid,
  _amount_cents integer,
  _reason       text,
  _method       public.payment_method default null
)
returns public.bill_status
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  _tenant uuid; _total integer; _paid integer; _refunded integer;
  _net integer; _status public.bill_status; _method_resolved public.payment_method;
  _distinct integer;
begin
  select tenant_id, total_cents into _tenant, _total from public.bills where id = _bill_id;
  if _tenant is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.refund') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _amount_cents <= 0 then
    raise exception 'refund must be positive' using errcode = '22023';
  end if;

  select coalesce(sum(amount_cents), 0) into _paid
  from public.payments where bill_id = _bill_id and status = 'completed';
  select coalesce(sum(amount_cents), 0) into _refunded
  from public.refunds where bill_id = _bill_id;

  if _amount_cents > _paid - _refunded then
    raise exception 'refund exceeds net paid' using errcode = '22023';
  end if;

  -- Caller wins. Otherwise infer, but only from a single-tender bill: guessing
  -- on a split bill would silently mis-state the drawer.
  _method_resolved := _method;
  if _method_resolved is null then
    select count(distinct method) into _distinct
    from public.payments where bill_id = _bill_id and status = 'completed';
    if _distinct = 1 then
      select method into _method_resolved
      from public.payments where bill_id = _bill_id and status = 'completed' limit 1;
    else
      raise exception 'refund method is required for a split-tender bill' using errcode = '22023';
    end if;
  end if;

  insert into public.refunds (tenant_id, bill_id, amount_cents, reason, approved_by, method)
  values (_tenant, _bill_id, _amount_cents, _reason, auth.uid(), _method_resolved);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'refund', 'bill', _bill_id,
          jsonb_build_object('amount_cents', _amount_cents, 'reason', _reason,
                             'method', _method_resolved));

  _net := _paid - (_refunded + _amount_cents);
  _status := case when _net <= 0 then 'void'
                  when _net < _total then 'partial'
                  else 'paid' end;
  update public.bills set status = _status where id = _bill_id;
  return _status;
end $function$;

revoke execute on function public.refund_payment(uuid, integer, text, public.payment_method) from anon, public;
grant execute on function public.refund_payment(uuid, integer, text, public.payment_method) to authenticated;
```

- [ ] **Step 4: Verify no stale overload survives**

```bash
npx supabase db push
```

Then run, and confirm the result is exactly one row with `pronargs = 4`:

```sql
select p.pronargs, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'refund_payment';
```

- [ ] **Step 5: Run the suite**

```bash
./supabase/tests/cash_guards.sh
```

Expected: PASS, 6 assertions green.

- [ ] **Step 6: Check existing refund callers still compile**

```bash
grep -rn "refund_payment" app components lib --include=*.ts --include=*.tsx
```

Callers passing three named args still resolve — `_method` defaults to null and is inferred. Any caller on a split-tender bill now needs an explicit method; note any such call site in the commit message rather than changing it here.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260815090100_refunds_method.sql supabase/tests/cash_guards.sh
git commit -m "feat(cash): record the method a refund was paid back in

Expected cash has to subtract cash refunds, and until now a refund's
tender was unrecoverable. Backfill covers single-tender bills only;
null stays non-cash so old rows cannot move a variance figure."
```

---

### Task 3: Movement RPCs

**Files:**
- Create: `supabase/migrations/20260815090200_cash_movement_rpcs.sql`
- Modify: `supabase/tests/cash_guards.sh`

**Interfaces:**
- Consumes: tables from Task 1; `public.has_permission(uuid, text)`; `public.cash_sessions`.
- Produces:
  - `record_cash_movement(_kind public.cash_movement_kind, _category public.cash_movement_category, _amount_cents integer, _note text) returns uuid`
  - `approve_cash_movement(_id uuid) returns void`
  - `reject_cash_movement(_id uuid) returns void`

Note: `record_cash_movement` takes **no** `_po_id`. The spec listed one, but a movement's link to purchasing is `supplier_payment_id`, written by Task 5's RPC — a second, looser link would be a way for the two to disagree.

- [ ] **Step 1: Write the failing test**

Append to `cash_guards.sh` before the summary block:

```bash
echo "== movement RPCs =="

# The cashier needs an open session to record against.
BODY=$(printf '{"_tenant":"%s","_branch_id":null,"_opening_float_cents":0}' "$TENANT")
SESSION=$(auth_rpc "$CASHIER" "open_cash_session" "$BODY" | tr -d '"')
[ -n "$SESSION" ] || { echo "could not open a cashier session"; exit 1; }

BODY='{"_kind":"payout","_category":"supplies","_amount_cents":20000,"_note":"guard test payout"}'
MOVE=$(auth_rpc "$CASHIER" "record_cash_movement" "$BODY" | tr -d '"')
case "$MOVE" in
  ????????-*) ok "cashier can record a payout";;
  *) bad "cashier can record a payout" "$MOVE";;
esac

OUT=$(auth_rpc "$WAITER" "record_cash_movement" "$BODY")
check "waiter cannot record a payout" "42501" "$OUT"

BODY=$(printf '{"_id":"%s"}' "$MOVE")
OUT=$(auth_rpc "$CASHIER" "approve_cash_movement" "$BODY")
check "cashier cannot approve their own payout" "42501" "$OUT"

OUT=$(auth_rpc "$OWNER" "approve_cash_movement" "$BODY")
check "owner can approve" "" "$OUT"
STATUS=$(auth_get "$OWNER" "cash_movements?id=eq.$MOVE&select=status" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['status'] if d else '')")
check "approved movement reads back as approved" "approved" "$STATUS"

BAD='{"_kind":"payout","_category":"other","_amount_cents":0,"_note":"zero"}'
OUT=$(auth_rpc "$CASHIER" "record_cash_movement" "$BAD")
check "a zero payout is refused" "22023" "$OUT"

BAD='{"_kind":"payout","_category":"other","_amount_cents":100,"_note":"   "}'
OUT=$(auth_rpc "$CASHIER" "record_cash_movement" "$BAD")
check "a blank note is refused" "22023" "$OUT"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `Could not find the function public.record_cash_movement` (`PGRST202`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090200_cash_movement_rpcs.sql`:

```sql
-- ============================================================================
-- Movement RPCs.
--
-- Recording reuses cash.manage, which the cashier role already holds — the
-- person holding the cash is the one who knows what happened. Approval CANNOT
-- reuse it for exactly that reason: a cashier with cash.manage would approve
-- their own payouts and the review step would be decorative. Hence cash.approve
-- (next migration), which must never reach the cashier role.
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
  -- The caller's own open session is the only drawer they can move cash in.
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
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db push && ./supabase/tests/cash_guards.sh
```

Expected: the "owner can approve" and "approved movement reads back as approved" assertions **fail** at this point — `cash.approve` does not exist yet, so `has_permission` returns false for everyone and the owner is refused too. ("cashier cannot approve their own payout" passes, but for the wrong reason — it will still pass once the key exists, which is what makes it meaningful.) That is correct: **Task 6** adds the key. Record the failures and move on, or run Task 6 before re-running.

All other assertions must pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815090200_cash_movement_rpcs.sql supabase/tests/cash_guards.sh
git commit -m "feat(cash): record, approve and reject cash movements

Recording reuses cash.manage (the cashier has it). Approval uses a
separate cash.approve, because a cashier approving their own payout
would make the review step decorative."
```

---

### Task 4: Rewrite close_cash_session

**Files:**
- Create: `supabase/migrations/20260815090300_close_cash_session_v2.sql`
- Create: `supabase/tests/cash_expected_math.sh`

**Interfaces:**
- Consumes: `cash_movements`, `refunds.method`, existing `close_cash_session(uuid, integer)` signature (unchanged — same arity, so `create or replace` is safe here).
- Produces: `close_cash_session(_session_id uuid, _counted_cents integer)` returning `table (expected_cents integer, counted_cents integer, variance_cents integer)` — same shape as before.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/cash_expected_math.sh`. This is the acceptance test: it reproduces the real 2026-08-14 shift and asserts the variance is zero.

```bash
#!/usr/bin/env bash
# The reconciliation acceptance test.
#
# The first real shift at The Sekuwa Station opened on 4,350, paid out 3,655 in
# cash purchases, took 3,080 in cash sales, and counted 3,775. The old
# close_cash_session reported a 545 shortfall because it only ever added sales.
# This asserts the rewritten one lands on zero.
#
#   export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
#   export DEMO_CASHIER_EMAIL=... DEMO_CASHIER_PASSWORD=...
#   TENANT=<tenant uuid> SERVICE_KEY=<service role key> ./cash_expected_math.sh
set -uo pipefail
cd "$(dirname "$0")/../../../extrahelper_flutter"

URL=$(python3 -c "import json;print(json.load(open('env.json'))['SUPABASE_URL'])")
KEY=$(python3 -c "import json;d=json.load(open('env.json'));print(d.get('SUPABASE_PUBLISHABLE_KEY') or d.get('SUPABASE_ANON_KEY'))")

OWNER_EMAIL="${DEMO_OWNER_EMAIL:?set DEMO_OWNER_EMAIL}"
OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:?set DEMO_OWNER_PASSWORD}"
CASHIER_EMAIL="${DEMO_CASHIER_EMAIL:?set DEMO_CASHIER_EMAIL}"
CASHIER_PASSWORD="${DEMO_CASHIER_PASSWORD:?set DEMO_CASHIER_PASSWORD}"
TENANT="${TENANT:?set TENANT}"
SERVICE_KEY="${SERVICE_KEY:?set SERVICE_KEY}"

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
CASHIER=$(login "$CASHIER_EMAIL" "$CASHIER_PASSWORD")
[ -n "$OWNER" ] || { echo "owner login failed"; exit 1; }
[ -n "$CASHIER" ] || { echo "cashier login failed"; exit 1; }
PASS=0; FAIL=0
auth_rpc() { curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
ok()  { PASS=$((PASS+1)); echo "  ok   — $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL — $1: $2"; }

echo "== the 2026-08-14 shift =="

# Open on 4,350 — the float that was actually in the drawer, including the 30
# that went uncounted at the previous open.
BODY=$(printf '{"_tenant":"%s","_branch_id":null,"_opening_float_cents":435000}' "$TENANT")
SESSION=$(auth_rpc "$CASHIER" "open_cash_session" "$BODY" | tr -d '"')
[ -n "$SESSION" ] || { echo "could not open a session"; exit 1; }

# The day's five cash purchases.
record() { # record <amount_cents> <category> <note>
  local body
  body=$(printf '{"_kind":"payout","_category":"%s","_amount_cents":%s,"_note":"%s"}' "$2" "$1" "$3")
  auth_rpc "$CASHIER" "record_cash_movement" "$body" | tr -d '"'
}
M1=$(record 245000 supplier "Mata Suppliers — tissue, mint flavour, coil, plastic")
M2=$(record  95500 supplier "Xtreme 6 + Surya pack")
M3=$(record   2000 supplies "Wai Wai Chow Chow")
M4=$(record  20000 supplies "Lemon")
M5=$(record   3000 supplies "Sikhar Ice x2")
for m in "$M1" "$M2" "$M3" "$M4" "$M5"; do
  case "$m" in ????????-*) ;; *) echo "failed to record a movement: $m"; exit 1;; esac
done

# Approve four; leave M5 pending so the close has to auto-approve it.
for m in "$M1" "$M2" "$M3" "$M4"; do
  auth_rpc "$OWNER" "approve_cash_movement" "$(printf '{"_id":"%s"}' "$m")" >/dev/null
done

# 3,080 of cash sales, injected as a completed cash payment against a bill this
# tenant already has. Uses the service key: this is fixture setup, not a guard.
BILL=$(curl -s "$URL/rest/v1/bills?tenant_id=eq.$TENANT&select=id&limit=1" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
[ -n "$BILL" ] || { echo "tenant has no bill to attach a payment to"; exit 1; }
PAY=$(curl -s -X POST "$URL/rest/v1/payments" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "$(printf '{"tenant_id":"%s","bill_id":"%s","method":"cash","amount_cents":308000,"status":"completed"}' "$TENANT" "$BILL")" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
[ -n "$PAY" ] || { echo "could not seed the cash sale"; exit 1; }

# Close on the counted 3,775.
BODY=$(printf '{"_session_id":"%s","_counted_cents":377500}' "$SESSION")
OUT=$(auth_rpc "$CASHIER" "close_cash_session" "$BODY")
EXPECTED=$(echo "$OUT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['expected_cents'] if d else '')")
VARIANCE=$(echo "$OUT" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['variance_cents'] if d else '')")

[ "$EXPECTED" = "377500" ] && ok "expected is 3,775.00" || bad "expected is 3,775.00" "got $EXPECTED"
[ "$VARIANCE" = "0" ]      && ok "variance is zero"     || bad "variance is zero"     "got $VARIANCE"

AUTO=$(curl -s "$URL/rest/v1/cash_movements?id=eq.$M5&select=status,auto_approved" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY")
case "$AUTO" in
  *'"status":"approved"'*'"auto_approved":true'*) ok "the pending movement was auto-approved at close";;
  *) bad "the pending movement was auto-approved at close" "$AUTO";;
esac

echo "== cleanup =="
del() { curl -s -X DELETE "$URL/rest/v1/$1" -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" >/dev/null; }
del "payments?id=eq.$PAY"
del "cash_movements?session_id=eq.$SESSION"
del "cash_sessions?id=eq.$SESSION"
echo "  fixtures removed"

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to verify it fails**

```bash
chmod +x supabase/tests/cash_expected_math.sh && ./supabase/tests/cash_expected_math.sh
```

Expected: FAIL — expected comes back as `743000` (float 435000 + sales 308000), variance `-365500`, because nothing subtracts payouts yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090300_close_cash_session_v2.sql`:

```sql
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
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db push && ./supabase/tests/cash_expected_math.sh
```

Expected: PASS — expected `377500`, variance `0`, M5 auto-approved.

If the approve calls in the fixture silently failed because `cash.approve` does not exist yet, only the auto-approved M5 counts and expected comes back as `435000 + 308000 - 3000 = 740000`. Run **Task 6**, then re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815090300_close_cash_session_v2.sql supabase/tests/cash_expected_math.sh
git commit -m "feat(cash): subtract payouts and cash refunds from expected

Expected was float + cash sales, so every rupee leaving the drawer read
as a shortfall. The acceptance test replays the 2026-08-14 shift that
exposed it and now lands on zero variance."
```

---

### Task 5: Supplier payment RPCs

**Files:**
- Create: `supabase/migrations/20260815090400_supplier_payment_rpcs.sql`
- Modify: `supabase/tests/cash_guards.sh`

**Interfaces:**
- Consumes: `supplier_payments`, `cash_movements`, `po_items`, `has_permission`.
- Produces:
  - `record_supplier_payment(_supplier_id uuid, _po_id uuid, _amount_cents integer, _method public.payment_method, _paid_at timestamptz, _note text) returns uuid`
  - `supplier_balances() returns table (supplier_id uuid, supplier_name text, received_cents bigint, paid_cents bigint, outstanding_cents bigint)`

- [ ] **Step 1: Write the failing test**

Append to `cash_guards.sh` before the summary:

```bash
echo "== supplier payments =="

SUPPLIER=$(curl -s -X POST "$URL/rest/v1/suppliers" -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$(printf '{"tenant_id":"%s","name":"Guard Test Supplier"}' "$TENANT")" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
[ -n "$SUPPLIER" ] || { echo "could not create a test supplier"; exit 1; }

BODY=$(printf '{"_supplier_id":"%s","_po_id":null,"_amount_cents":10000,"_method":"bank","_paid_at":null,"_note":"guard bank payment"}' "$SUPPLIER")
SP=$(auth_rpc "$OWNER" "record_supplier_payment" "$BODY" | tr -d '"')
case "$SP" in ????????-*) ok "owner can record a bank supplier payment";; *) bad "owner can record a bank supplier payment" "$SP";; esac

COUNT=$(auth_get "$OWNER" "cash_movements?supplier_payment_id=eq.$SP&select=id" \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "a bank payment writes no drawer movement" "0" "$COUNT"

BODY=$(printf '{"_supplier_id":"%s","_po_id":null,"_amount_cents":10000,"_method":"cash","_paid_at":null,"_note":"guard cash payment"}' "$SUPPLIER")
SPC=$(auth_rpc "$OWNER" "record_supplier_payment" "$BODY" | tr -d '"')
case "$SPC" in ????????-*) ok "owner can record a cash supplier payment";; *) bad "owner can record a cash supplier payment" "$SPC";; esac

COUNT=$(auth_get "$OWNER" "cash_movements?supplier_payment_id=eq.$SPC&select=id" \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "a cash payment writes exactly one drawer movement" "1" "$COUNT"

OUT=$(auth_rpc "$WAITER" "record_supplier_payment" "$BODY")
check "waiter cannot record a supplier payment" "42501" "$OUT"

OUT=$(auth_rpc "$OWNER" "supplier_balances" '{}')
case "$OUT" in \[*) ok "supplier_balances returns rows";; *) bad "supplier_balances returns rows" "$OUT";; esac

# Cleanup for this section.
curl -s -X DELETE "$URL/rest/v1/cash_movements?supplier_payment_id=eq.$SPC" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
curl -s -X DELETE "$URL/rest/v1/supplier_payments?supplier_id=eq.$SUPPLIER" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
curl -s -X DELETE "$URL/rest/v1/suppliers?id=eq.$SUPPLIER" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
```

**Atomicity assertion.** Add this too — it is the one that matters most, because a half-written pair is worse than a refusal. It runs as the owner with **no open session**, so the cash branch must fail and leave nothing behind:

```bash
# Close any session the owner happens to have open, so the cash path has none.
OWNER_SESSION=$(auth_get "$OWNER" "cash_sessions?status=eq.open&select=id" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
if [ -n "$OWNER_SESSION" ]; then
  auth_rpc "$OWNER" "close_cash_session" "$(printf '{"_session_id":"%s","_counted_cents":0}' "$OWNER_SESSION")" >/dev/null
fi

SUP2=$(curl -s -X POST "$URL/rest/v1/suppliers" -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$(printf '{"tenant_id":"%s","name":"Guard Atomicity Supplier"}' "$TENANT")" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
BODY=$(printf '{"_supplier_id":"%s","_po_id":null,"_amount_cents":5000,"_method":"cash","_paid_at":null,"_note":"no session"}' "$SUP2")
OUT=$(auth_rpc "$OWNER" "record_supplier_payment" "$BODY")
check "a cash payment with no open session is refused" "P0002" "$OUT"
ORPHANS=$(auth_get "$OWNER" "supplier_payments?supplier_id=eq.$SUP2&select=id" \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "the refused payment left no orphan row" "0" "$ORPHANS"
curl -s -X DELETE "$URL/rest/v1/suppliers?id=eq.$SUP2" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" >/dev/null
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `Could not find the function public.record_supplier_payment` (`PGRST202`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090400_supplier_payment_rpcs.sql`:

```sql
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
  _tenant uuid; _branch uuid; _session uuid; _id uuid;
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
          coalesce(_paid_at, now()), nullif(btrim(coalesce(_note, '')), ''), _uid)
  returning id into _id;

  if _method = 'cash' then
    insert into public.cash_movements
      (tenant_id, branch_id, session_id, kind, category, amount_cents, note,
       supplier_payment_id, created_by)
    values (_tenant, _branch, _session, 'payout', 'supplier', _amount_cents,
            coalesce(nullif(btrim(coalesce(_note, '')), ''),
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
    select s.id, s.name, s.tenant_id
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
```

- [ ] **Step 4: Apply and run**

```bash
npx supabase db push && ./supabase/tests/cash_guards.sh
```

Expected: PASS on the supplier section. The two `cash.approve` assertions still fail until Task 7.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815090400_supplier_payment_rpcs.sql supabase/tests/cash_guards.sh
git commit -m "feat(purchasing): record supplier payments and derive balances

A cash payment writes its drawer movement in the same transaction, so
the two can never disagree. Balances come from received value minus
payments rather than a stored total that would drift."
```

---

### Task 6: The `cash.approve` permission, and dropping a column that lies

**Files:**
- Create: `supabase/migrations/20260815090500_cash_approve_permission.sql`
- Modify: `supabase/tests/cash_guards.sh`

**Interfaces:**
- Consumes: `public.permissions`, `public.roles`, `public.role_permissions`, `public.default_role_permissions(app_role)`.
- Produces: permission key `cash.approve`; `purchase_orders.total_cents` removed.

- [ ] **Step 1: Write the failing test**

Append to `cash_guards.sh` before the summary:

```bash
echo "== cash.approve =="
PERM=$(auth_get "$OWNER" "permissions?key=eq.cash.approve&select=key" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['key'] if d else '')")
check "cash.approve exists in the catalog" "cash.approve" "$PERM"

MINE=$(auth_rpc "$OWNER" "get_my_permissions" "$(printf '{"_tenant":"%s"}' "$TENANT")")
check "owner holds cash.approve" "cash.approve" "$MINE"

MINE=$(auth_rpc "$CASHIER" "get_my_permissions" "$(printf '{"_tenant":"%s"}' "$TENANT")")
case "$MINE" in
  *"cash.approve"*) bad "cashier does NOT hold cash.approve" "$MINE";;
  *) ok "cashier does NOT hold cash.approve";;
esac
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL on all three — the key does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260815090500_cash_approve_permission.sql`:

```sql
-- ============================================================================
-- cash.approve, and the removal of a column that always read zero.
--
-- The cashier role already holds cash.manage, so approval had to be a separate
-- key or a cashier would sign off their own payouts.
--
-- default_role_permissions gives owner every key and manager every key except
-- billing.view, so both pick this up automatically for members whose role_id is
-- null. Members pointed at a system role carry explicit role_permissions rows
-- and need the backfill below.
-- ============================================================================

insert into public.permissions (key, grp, label, sort) values
  ('cash.approve','Order','Approve cash payouts',215)
on conflict (key) do nothing;

-- Backfill onto existing system owner and manager roles — and only those. The
-- cashier role must not receive it.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'cash.approve'
from public.roles r
where r.is_system and r.base_role in ('owner', 'manager')
on conflict do nothing;

-- purchase_orders.total_cents has never been written by any migration, action,
-- or component — it has always read 0. A column that looks authoritative and
-- is always wrong is worse than no column; PO value is summed from po_items.
alter table public.purchase_orders drop column if exists total_cents;
```

- [ ] **Step 4: Apply and run both suites**

```bash
npx supabase db push
./supabase/tests/cash_guards.sh
./supabase/tests/cash_expected_math.sh
```

Expected: both PASS in full, including the two `cash.approve` assertions deferred from Task 3.

- [ ] **Step 5: Confirm nothing referenced the dropped column**

```bash
grep -rn "total_cents" app components lib --include=*.ts --include=*.tsx | grep -i "purchase\|po_"
```

Expected: no hits. `bills.total_cents` and `po_items.unit_cost_cents` are different columns and must stay.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260815090500_cash_approve_permission.sql supabase/tests/cash_guards.sh
git commit -m "feat(cash): add cash.approve and drop purchase_orders.total_cents

The cashier role already holds cash.manage, so approval needed its own
key. total_cents was never written by anything and always read zero."
```

---

### Task 7: Regenerate database types

**Files:**
- Modify: `lib/supabase/database.types.ts`

- [ ] **Step 1: Regenerate**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

- [ ] **Step 2: Verify the new shapes landed**

```bash
grep -n "cash_movements\|supplier_payments\|cash_movement_kind\|record_supplier_payment" lib/supabase/database.types.ts | head -20
```

Expected: both tables, all three enums, and all five RPCs present.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. If a pre-existing error appears from the in-flight digital-payments work, note it and do not fix it here.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/database.types.ts
git commit -m "chore: regenerate database types for cash movements"
```

---

### Task 8: Cash drawer UI — movement entry and approval

**Files:**
- Modify: `components/cash/types.ts`
- Modify: `app/(app)/cash/actions.ts`
- Modify: `app/(app)/cash/page.tsx`
- Modify: `components/cash/session-card.tsx`
- Create: `components/cash/movement-dialog.tsx`
- Create: `components/cash/movements-panel.tsx`

**Interfaces:**
- Consumes: `record_cash_movement`, `approve_cash_movement`, `reject_cash_movement` from Task 3.
- Produces: `CashMovement` type; server actions `recordMovement`, `approveMovement`, `rejectMovement`, all `(prev: CashState, formData: FormData) => Promise<CashState>`.

**Constraint, repeated because it is the easy thing to get wrong:** this panel must not render expected, cash sales, or any figure derived from them. Movement amounts and their total are fine.

- [ ] **Step 1: Add the type**

Append to `components/cash/types.ts`:

```ts
export type CashMovement = {
  id: string
  kind: "payout" | "paid_in"
  category: "supplier" | "supplies" | "utilities" | "staff_advance" | "transport" | "other"
  amount_cents: number
  note: string
  status: "pending" | "approved" | "rejected"
  auto_approved: boolean
  created_at: string
  /** Display name of whoever recorded it; null if unknown. */
  recorded_by: string | null
}

export const MOVEMENT_CATEGORY_LABELS: Record<CashMovement["category"], string> = {
  supplier: "Supplier",
  supplies: "Supplies",
  utilities: "Utilities",
  staff_advance: "Staff advance",
  transport: "Transport",
  other: "Other",
}
```

The label map exists because enum values never reach staff — `"staff_advance"` must render as "Staff advance", and `.replace("_", " ")` is not a label system.

- [ ] **Step 2: Add the server actions**

Append to `app/(app)/cash/actions.ts`:

```ts
/** Record a payout or paid-in against the caller's open session. */
export async function recordMovement(
  _prev: CashState,
  formData: FormData,
): Promise<CashState> {
  await requireRole(...CASH_ROLES)
  const kind = String(formData.get("kind") ?? "")
  const category = String(formData.get("category") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const amountCents = Math.round(Number(formData.get("amount") ?? 0) * 100)

  if (kind !== "payout" && kind !== "paid_in") return { error: "Pick cash out or cash in." }
  if (!category) return { error: "Pick a category." }
  if (!note) return { error: "Say what this was for." }
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return { error: "Amount must be more than zero." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_cash_movement", {
    _kind: kind,
    _category: category,
    _amount_cents: amountCents,
    _note: note,
  })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

async function setMovementStatus(
  formData: FormData,
  rpc: "approve_cash_movement" | "reject_cash_movement",
): Promise<CashState> {
  await requireRole("owner", "manager")
  const id = String(formData.get("movementId") ?? "")
  if (!id) return { error: "No movement selected." }

  const supabase = await createClient()
  const { error } = await supabase.rpc(rpc, { _id: id })
  if (error) return { error: error.message }

  revalidatePath("/cash")
  return { ok: true }
}

export async function approveMovement(_prev: CashState, formData: FormData): Promise<CashState> {
  return setMovementStatus(formData, "approve_cash_movement")
}

export async function rejectMovement(_prev: CashState, formData: FormData): Promise<CashState> {
  return setMovementStatus(formData, "reject_cash_movement")
}
```

- [ ] **Step 3: Build the entry dialog**

Create `components/cash/movement-dialog.tsx`:

```tsx
"use client"

import { useActionState, useState } from "react"
import { ArrowDownLeft, ArrowUpRight } from "lucide-react"
import { recordMovement, type CashState } from "@/app/(app)/cash/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MOVEMENT_CATEGORY_LABELS, type CashMovement } from "./types"

export function MovementDialog({
  kind,
  currency,
}: {
  kind: CashMovement["kind"]
  currency: string
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<CashState, FormData>(
    async (prev, formData) => {
      const result = await recordMovement(prev, formData)
      if (result && "ok" in result) setOpen(false)
      return result
    },
    undefined,
  )

  const isPayout = kind === "payout"
  const Icon = isPayout ? ArrowUpRight : ArrowDownLeft

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-11 flex-1" />}>
        <Icon className="size-4" />
        {isPayout ? "Cash out" : "Cash in"}
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <DialogTitle>{isPayout ? "Cash out" : "Cash in"}</DialogTitle>
            <DialogDescription>
              {isPayout
                ? "Money leaving the drawer — a supplier paid, supplies bought, a staff advance."
                : "Money added to the drawer from outside a sale."}
            </DialogDescription>
          </DialogHeader>

          <input type="hidden" name="kind" value={kind} />

          <div className="flex flex-col gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="amount">Amount ({currency})</FieldLabel>
              <Input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                required
                className="tabular-nums"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <Select name="category" defaultValue={isPayout ? "supplies" : "other"}>
                <SelectTrigger id="category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MOVEMENT_CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="note">What was it for?</FieldLabel>
              <Input id="note" name="note" required maxLength={280} />
              <FieldDescription>
                Name the supplier or the goods. A manager reviews this before the shift closes.
              </FieldDescription>
            </Field>

            {state && "error" in state ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending} className="h-11">
              {pending ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

Check the actual `Dialog` and `Select` exports in `components/ui/` before writing — match whatever the repo's shadcn/base-ui wrappers expose. Remember the trap: our `Select` derives its labels from the `items` map built off `SelectItem` children, so `SelectValue` renders raw values if the children are missing.

- [ ] **Step 4: Build the panel**

Create `components/cash/movements-panel.tsx`:

```tsx
"use client"

import { useActionState } from "react"
import { Check, X, Zap } from "lucide-react"
import { approveMovement, rejectMovement, type CashState } from "@/app/(app)/cash/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { money } from "@/lib/format"
import { MovementDialog } from "./movement-dialog"
import { MOVEMENT_CATEGORY_LABELS, type CashMovement } from "./types"

function StatusBadge({ movement }: { movement: CashMovement }) {
  if (movement.status === "rejected")
    return (
      <Badge variant="outline" className="text-destructive">
        <X className="size-3" /> Rejected
      </Badge>
    )
  if (movement.status === "pending")
    return (
      <Badge variant="outline" className="text-amber-600">
        Pending
      </Badge>
    )
  return (
    <Badge variant="outline" className="text-emerald-600">
      <Check className="size-3" />
      Approved
      {movement.auto_approved ? <Zap className="size-3" aria-label="auto-approved at close" /> : null}
    </Badge>
  )
}

function ReviewButtons({ id }: { id: string }) {
  const [, approve, approving] = useActionState<CashState, FormData>(approveMovement, undefined)
  const [, reject, rejecting] = useActionState<CashState, FormData>(rejectMovement, undefined)

  return (
    <div className="flex justify-end gap-2">
      <form action={approve}>
        <input type="hidden" name="movementId" value={id} />
        <Button type="submit" size="icon" className="size-11" disabled={approving} aria-label="Approve">
          <Check className="size-4" />
        </Button>
      </form>
      <form action={reject}>
        <input type="hidden" name="movementId" value={id} />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="size-11"
          disabled={rejecting}
          aria-label="Reject"
        >
          <X className="size-4" />
        </Button>
      </form>
    </div>
  )
}

export function MovementsPanel({
  movements,
  currency,
  canApprove,
}: {
  movements: CashMovement[]
  currency: string
  canApprove: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <MovementDialog kind="payout" currency={currency} />
        <MovementDialog kind="paid_in" currency={currency} />
      </div>

      {movements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cash has moved in or out this shift. Record a payout when you pay a supplier or buy
          supplies from the drawer.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>What for</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              {canApprove ? <TableHead className="text-right">Review</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.note}</TableCell>
                <TableCell>{MOVEMENT_CATEGORY_LABELS[m.category]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.kind === "payout" ? "−" : "+"}
                  {money(m.amount_cents, currency)}
                </TableCell>
                <TableCell>
                  <StatusBadge movement={m} />
                </TableCell>
                {canApprove ? (
                  <TableCell>
                    {m.status === "pending" ? <ReviewButtons id={m.id} /> : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
```

The `−` / `+` sign is doing real work: colour alone must never carry meaning, and this table is exactly where a red-green split would fail a colourblind cashier.

- [ ] **Step 5: Load movements in the page**

In `app/(app)/cash/page.tsx`, after the open-session query resolves, add a movements query and a permission read. Add to the existing `Promise.all` destructure or fetch after it, since it depends on `open?.id`:

```ts
const canApprove = tenant.permissions?.includes("cash.approve") ?? false

const { data: movementRows } = open
  ? await supabase
      .from("cash_movements")
      .select("id, kind, category, amount_cents, note, status, auto_approved, created_at, created_by")
      .eq("session_id", open.id)
      .order("created_at", { ascending: false })
  : { data: [] }

// created_by points at auth.users, so PostgREST cannot infer the join — resolve
// the display names the same way the shift reports below do.
const recorderIds = [...new Set((movementRows ?? []).map((m) => m.created_by).filter(Boolean))]
const { data: recorders } = recorderIds.length
  ? await supabase.from("profiles").select("id, full_name, username").in("id", recorderIds)
  : { data: [] }
const recorderById = new Map(
  (recorders ?? []).map((p) => [p.id, p.full_name || (p.username ? `@${p.username}` : null)]),
)

const movements: CashMovement[] = (movementRows ?? []).map((m) => ({
  id: m.id,
  kind: m.kind,
  category: m.category,
  amount_cents: m.amount_cents,
  note: m.note,
  status: m.status,
  auto_approved: m.auto_approved,
  created_at: m.created_at,
  recorded_by: recorderById.get(m.created_by) ?? null,
}))
```

Check how `requirePermission` exposes the caller's permission set in `lib/supabase/guards.ts` — if `tenant.permissions` is not on the returned object, call `get_my_permissions` here instead, or add a second `requirePermission`-style helper. Do not guess.

Pass `movements` and `canApprove` down to `SessionCard`.

- [ ] **Step 6: Render the panel in the session card**

In `components/cash/session-card.tsx`, thread `movements` and `canApprove` through `SessionCard` into `CloseCard`, and render `<MovementsPanel …/>` above the close form. Add a pending warning just above the submit button:

```tsx
{pendingCount > 0 ? (
  <p className="text-sm text-amber-600" role="status">
    {pendingCount} {pendingCount === 1 ? "entry" : "entries"} still awaiting approval will be
    auto-approved when you close.
  </p>
) : null}
```

with `const pendingCount = movements.filter((m) => m.status === "pending").length`.

Leave the existing `FieldDescription` — *"The expected total is only worked out after you submit, so the count stays honest"* — exactly as it is. It is still true and it is the reason the panel shows no expected figure.

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit && npm run lint
```

Then run the app and walk it manually — there is no browser test runner in this repo:

```bash
npm run dev
```

1. Open a drawer as a cashier. Record a 2,450 payout.
2. Confirm the row appears as Pending, and that **no expected figure is anywhere on screen**.
3. As an owner, approve it. As the cashier, confirm the approve buttons do not render.
4. Close with a count. Confirm expected reflects the payout.

- [ ] **Step 8: Commit**

```bash
git add components/cash app/\(app\)/cash
git commit -m "feat(cash): record and review drawer movements in the UI

The panel deliberately shows no expected figure while the session is
open — a cashier who can see expected can tune the count to match it,
which is the whole reason the close reveals it only after submit."
```

---

### Task 9: Purchasing UI — payments and payables

**Files:**
- Modify: `app/(app)/purchasing/actions.ts`
- Modify: `app/(app)/purchasing/page.tsx`
- Modify: `components/purchasing-manager.tsx`
- Create: `components/purchasing/payment-dialog.tsx`
- Create: `components/purchasing/payables.tsx`

**Interfaces:**
- Consumes: `record_supplier_payment`, `supplier_balances` from Task 5.
- Produces: server action `recordSupplierPayment(prev, formData)`; type `SupplierBalance`.

- [ ] **Step 1: Add the server action**

Append to `app/(app)/purchasing/actions.ts`, following the file's existing `requireRole("owner","manager","inventory")` pattern:

```ts
export async function recordSupplierPayment(
  _prev: PurchasingState,
  formData: FormData,
): Promise<PurchasingState> {
  await requireRole("owner", "manager", "inventory")
  const supplierId = String(formData.get("supplierId") ?? "")
  const poId = String(formData.get("poId") ?? "") || null
  const method = String(formData.get("method") ?? "")
  const note = String(formData.get("note") ?? "").trim() || null
  const paidAt = String(formData.get("paidAt") ?? "") || null
  const amountCents = Math.round(Number(formData.get("amount") ?? 0) * 100)

  if (!supplierId) return { error: "Pick a supplier." }
  if (!method) return { error: "Pick how it was paid." }
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return { error: "Amount must be more than zero." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_supplier_payment", {
    _supplier_id: supplierId,
    _po_id: poId,
    _amount_cents: amountCents,
    _method: method,
    _paid_at: paidAt ? new Date(paidAt).toISOString() : null,
    _note: note,
  })
  if (error) return { error: error.message }

  revalidatePath("/purchasing")
  return { ok: true }
}
```

Match the existing state type name in that file — it may not be `PurchasingState`. Read the top of the file first.

- [ ] **Step 2: Build the payment dialog**

Create `components/purchasing/payment-dialog.tsx`. Same shape as `movement-dialog.tsx` from Task 8: a `Dialog` wrapping a `form action={action}`, fields for amount, method (`Select` over `cash`, `bank`, `esewa`, `fonepay`, `card`, `wallet`, `other` — read the live enum, do not hardcode a stale list), date, and note; hidden inputs for `supplierId` and `poId`; error surfaced via `role="alert"`.

Its description must name the consequence of the cash option, because that is the one with a side effect:

```tsx
<DialogDescription>
  Paying in cash also records a payout against your open drawer, so the shift
  reconciles. If the cash came from somewhere else, pick Bank or Other.
</DialogDescription>
```

- [ ] **Step 3: Build the payables block**

Create `components/purchasing/payables.tsx`: a `Card` containing a `Table` with headers Supplier, Received, Paid, Outstanding. Numeric columns right-aligned with `tabular-nums`. Outstanding above zero renders `text-amber-600` **with the word "owing"** beside it, never colour alone. Empty state teaches the next step: *"Nothing owed. Record a payment when you settle a delivery."*

```tsx
export type SupplierBalance = {
  supplier_id: string
  supplier_name: string
  received_cents: number
  paid_cents: number
  outstanding_cents: number
}
```

- [ ] **Step 4: Load balances in the page**

In `app/(app)/purchasing/page.tsx`, add to the existing parallel fetch:

```ts
const { data: balances } = await supabase.rpc("supplier_balances")
```

Pass to `PurchasingManager`, which renders `<Payables balances={balances ?? []} currency={tenant.currency} />` above the purchase-orders list, and a **Record payment** trigger on each `POCard` (around `components/purchasing-manager.tsx:82`) alongside the existing receive controls.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run dev
```

Walk it: record a bank payment against a received PO, confirm outstanding drops and **no drawer movement appears**. Then record a cash payment with a drawer open, and confirm a matching payout shows on `/cash`.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/purchasing components/purchasing components/purchasing-manager.tsx
git commit -m "feat(purchasing): record supplier payments and show what is owed"
```

---

### Task 10: Backfill the 2026-08-14 purchases, and document

**Files:**
- Modify: `TASKS.md`

The closed 2026-08-14 session keeps its recorded numbers. Rewriting a closed session's count would falsify a count a person actually performed. Enter the day's purchases through the new UI so inventory and payables are right going forward.

- [ ] **Step 1: Enter the purchases**

Through `/purchasing`, as the owner. Create suppliers where they do not exist, then record each payment with `paid_at` set to 2026-08-14 and method **Other** (the drawer session for that day is closed, so cash is not available and would be wrong anyway):

| Supplier | Note | NPR |
|---|---|---|
| Mata Suppliers | tissue, mint flavour, coil, plastic | 2,450 |
| (as applicable) | Xtreme 6 + Surya pack | 955 |
| (as applicable) | Wai Wai Chow Chow | 20 |
| (as applicable) | Lemon | 200 |
| (as applicable) | Sikhar Ice ×2 | 30 |

Total 3,655.

- [ ] **Step 2: Open the next session on the right float**

The next drawer opens at **3,775** — the physical count from the close, which already includes the 30 that went uncounted at the previous open.

- [ ] **Step 3: Update TASKS.md**

Record: both suites and their pass counts, that the 2026-08-14 variance of −545 stands as a day-one artifact, and the two open follow-ups — the Flutter plan, and `20260814180000_digital_payment_methods.sql` being absent from `supabase_migrations.schema_migrations`.

- [ ] **Step 4: Final verification**

```bash
./supabase/tests/cash_guards.sh
./supabase/tests/cash_expected_math.sh
./supabase/tests/menu_write_guards.sh
npx tsc --noEmit
npm run lint
```

All green before claiming done. Paste the actual output — do not assert a pass you have not seen.

- [ ] **Step 5: Commit**

```bash
git add TASKS.md
git commit -m "docs: record cash movement test results and open follow-ups"
```

---

## Deferred to the Flutter plan

The spec's Flutter surface is a separate plan, written once these RPC signatures are settled: a cash repository over the same five RPCs, providers, a movements panel on the POS cash screen, permission gating on `cash.approve`, and an integration test on the simulator mirroring `integration_test/menu_edit_device_test.dart`.
