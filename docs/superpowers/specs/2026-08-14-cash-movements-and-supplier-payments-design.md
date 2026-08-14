# Cash movements and supplier payments

**Date:** 2026-08-14
**Status:** Approved design, not yet planned

## Problem

The cash drawer and the purchasing module do not know about each other. Neither
records money leaving the till.

`close_cash_session` computes:

```
expected = opening_float + sum(cash payments completed since opened_at)
```

Nothing subtracts. So every cash rupee that leaves the drawer for any reason
other than a refundless sale shows up as a shortfall with no explanation.

Receiving a purchase order moves stock and overwrites item cost, but records no
payment: no payment row, no ledger entry, no session link.
`purchase_orders.total_cents` exists and is never written by any migration,
action, or component — it is always 0.

Cash refunds are not subtracted either. `refunds` has a `payment_id` column that
`refund_payment()` never sets, and no method column, so there is currently no
way to tell whether a refund was returned in cash.

The first real shift at The Sekuwa Station, 2026-08-14, shows the cost:

| | NPR |
|---|---|
| Cash in drawer at open | 4,350 |
| Cash purchases | 3,655 |
| Cash sales | 3,080 |
| Counted at close | 3,775 |

The system recorded `expected 4,320, counted 3,775, variance -545`. Two large
unrecorded flows nearly cancelled. The variance number was meaningless — it
neither detected the missing purchases nor the unrung sales.

## Goals

- Every rupee leaving or entering the drawer is recorded, attributed, and
  subtracted from or added to expected.
- Variance means something: a non-zero variance is a real discrepancy.
- Track what is owed to suppliers, since deliveries commonly arrive on credit
  (udhaaro).
- Keep the entry path for a 20 NPR packet of Wai Wai fast enough that staff
  actually use it.

## Non-goals

- Full double-entry accounting or a general ledger.
- Supplier invoices, aging buckets, or payment scheduling.
- Rewriting the numbers on the already-closed 2026-08-14 session.

## Decisions

Each of these was chosen deliberately; the rejected alternative is recorded so a
later reader does not relitigate it.

**Two entry paths, not one.** Stocked goods go through Purchasing (PO, receive,
inventory updates). Small or one-off spends go through a quick drawer payout
with amount, category, and note. Forcing a supplier and inventory item for a 20
NPR purchase guarantees staff skip it, which returns us to unexplained variance.
The trade-off accepted: small buys do not update inventory counts.

**Two tables, not one.** `cash_movements` means physical cash in or out of the
POS drawer, nothing else. `supplier_payments` means money owed to and paid to a
supplier, by any method. A cash-method supplier payment writes one row in each,
linked, inside a single RPC.

Rejected: a single table with a `source` column covering bank payments. A table
named for cash holding non-cash rows means every future query needs a filter it
can silently omit.

Rejected: supplier payments only, with misc spends attributed to a "Misc"
pseudo-supplier. Junk supplier rows, and drawer paid-in has nowhere to live.

**Drawer payouts require an open session.** `cash_movements.session_id` is NOT
NULL. Cash cannot leave a drawer that is not open. A supplier paid at 6am before
any shift opens is recorded as a `supplier_payments` row with a non-cash method
— the spend is tracked, the drawer is untouched, and no phantom movement is
attached to an unrelated later session.

**Cashiers record, managers approve, close auto-approves.** The person holding
the cash is the one who knows what happened, so the cashier records. A manager
approves. Anything still pending when the shift closes is auto-approved rather
than blocking the close.

This is a deliberate loosening: approval is a review step, not a hard control. A
cashier who records a fabricated payout shortly before close will get it through.
The compensating control is visibility — auto-approved entries are flagged
distinctly in the shift report so an owner can scan for them. Chosen over
blocking the close, which would strand staff late at night waiting on an owner's
phone.

One benefit falls out: because close resolves everything pending, a closed
session is final. No closed session ever needs its expected or variance
recomputed later.

**Reuse `public.payment_method` for supplier payments.** The enum already gained
`esewa`, `fonepay`, and `bank`. Suppliers in Nepal are paid the same ways guests
are. Only `'cash'` spawns a drawer movement.

**Payables are derived, not stored.** Outstanding per supplier is
`sum(po_items.qty_received * unit_cost_cents) - sum(supplier_payments.amount_cents)`.
A stored balance is a second source of truth that drifts.

**Drop `purchase_orders.total_cents`.** It has never been written. A column that
always reads 0 is worse than no column, because it looks authoritative.

## Data model

```sql
create type cash_movement_kind     as enum ('payout', 'paid_in');
create type cash_movement_status   as enum ('pending', 'approved', 'rejected');
create type cash_movement_category as enum
  ('supplier', 'supplies', 'utilities', 'staff_advance', 'transport', 'other');

-- Money paid to a supplier, by any method. Tracks credit (udhaaro).
create table public.supplier_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  branch_id    uuid references public.branches(id),
  supplier_id  uuid not null references public.suppliers(id) on delete restrict,
  po_id        uuid references public.purchase_orders(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method       public.payment_method not null,
  paid_at      timestamptz not null default now(),
  note         text,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);

-- Physical cash in or out of the POS drawer. Drawer only.
create table public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid references public.branches(id),
  session_id    uuid not null references public.cash_sessions(id) on delete cascade,
  kind          cash_movement_kind not null,
  category      cash_movement_category not null,
  amount_cents  integer not null check (amount_cents > 0),
  note          text not null check (length(btrim(note)) > 0),
  supplier_payment_id uuid references public.supplier_payments(id) on delete set null,
  status        cash_movement_status not null default 'pending',
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  auto_approved boolean not null default false
);
```

`supplier_payments` is created first so the `cash_movements` foreign key
resolves.

`po_id` is nullable so an on-account payment can settle old credit without being
tied to one delivery.

`note` is required on movements. A payout with no stated reason cannot be
audited later, which defeats the purpose of recording it.

`category` exists so reports can total spend without parsing free text.

Indexes: `cash_movements(session_id)`, `cash_movements(tenant_id, created_at)`,
`supplier_payments(tenant_id, supplier_id)`, `supplier_payments(po_id)`.

### Refunds

```sql
alter table public.refunds add column method public.payment_method;
```

Backfill from the bill's payments where every completed payment on that bill
shares one method; leave null where ambiguous. `refund_payment()` gains a
`_method` argument, defaulting to the unambiguous bill method and required when
the bill was settled by mixed methods.

Null is treated as non-cash in the expected calculation, so historical rows
cannot corrupt new variance figures.

## Expected calculation

```
expected = opening_float
         + cash sales       payments.method = 'cash', status = 'completed',
                            created_at >= opened_at
         - cash refunds      refunds.method = 'cash', created_at >= opened_at
         - approved payouts  cash_movements kind = 'payout', status = 'approved'
         + approved paid-in  cash_movements kind = 'paid_in', status = 'approved'
```

`close_cash_session(_session_id, _counted_cents)` is rewritten so that, within
one transaction:

1. Every `pending` movement on the session becomes `approved`, with
   `auto_approved = true`, `approved_by = auth.uid()`, `approved_at = now()`.
2. The formula above runs, counting only `status = 'approved'`.
3. `expected_cents`, `counted_cents`, `variance_cents` are written and the
   session closes.

Rejected movements never count.

## RPCs

All security definer, `set search_path = 'public'`, tenant-checked against
`user_tenants`, permission-checked via `has_permission()`, following the pattern
established by the menu write guards.

| Function | Permission | Behaviour |
|---|---|---|
| `record_cash_movement(_kind, _category, _amount_cents, _note)` | `cash.manage` | Inserts against the caller's open session with `status = 'pending'`. Raises if no open session. |
| `approve_cash_movement(_id)` | `cash.approve` | Sets `approved`. Only while the session is open. |
| `reject_cash_movement(_id)` | `cash.approve` | Sets `rejected`. Only while the session is open. |
| `record_supplier_payment(_supplier_id, _po_id, _amount_cents, _method, _paid_at, _note)` | `purchasing.edit` | Inserts `supplier_payments`. If `_method = 'cash'`, also inserts a linked `cash_movements` payout with category `supplier` on the open session. Atomic: both rows or neither. Raises if `_method = 'cash'` and no session is open. |
| `supplier_balances()` | `purchasing.view` | Per supplier: received value, paid, outstanding. |

`record_cash_movement` takes no PO reference. A movement's link to purchasing is
`supplier_payment_id`, written by `record_supplier_payment`; a second, looser
link would be a way for the two to disagree.

Recording reuses the existing `cash.manage` key, which the cashier role already
holds (`20260712091000_seed_system_roles.sql:15`). Approval **cannot** reuse it
for exactly that reason — a cashier holding `cash.manage` would approve their
own payouts and the review step would be decorative. So the one new key is
`cash.approve`, and it must not reach the cashier role.

`default_role_permissions` gives owner every key and manager every key except
`billing.view`, so both pick up `cash.approve` automatically for members whose
`role_id` is null. Members pointed at a system role carry explicit
`role_permissions` rows and need a backfill.

`purchasing.edit` and `purchasing.view` already exist and are unchanged.

RLS on both new tables: tenant-scoped select for tenant members; no direct
insert, update, or delete for any role. All writes go through the RPCs above.

## UI

### Cash drawer (`app/(app)/cash/`, `components/cash/`)

The open session card gains a movements panel: a `Cash out` and `Cash in`
action, and the session's movements with status and a running total of
movements.

**The panel must not show expected, cash sales, or any figure derived from
them while the session is open.** `components/cash/session-card.tsx` already
states the reason to the user — *"The expected total is only worked out after
you submit, so the count stays honest."* A cashier who can see expected can tune
the physical count to match it, which drives variance permanently to zero and
destroys the signal this whole feature exists to produce. Movement amounts are
safe to show: the cashier handed that money over and already knows it.

Approve and reject controls render only for holders of `cash.approve`.

The close dialog warns when entries are still pending: *"3 entries will be
auto-approved on close."*

Shift reports expand to show the same breakdown. Auto-approved entries carry a
distinct marker — this is the compensating control for auto-approve at close.

### Purchasing (`components/purchasing-manager.tsx`)

`POCard` gains received value, paid, and outstanding, plus a **Record payment**
action taking amount, method, date, and note.

The supplier list gains an outstanding column. A payables block shows total
owed, per-supplier balance, and the oldest unpaid PO.

No new navigation entries.

### Flutter (`extrahelper_flutter`)

Because all logic lives in the RPCs, the Flutter client calls the same
functions. A cash repository plus providers, a movements panel on the POS cash
screen, and permission gating mirroring the web, following the pattern of the
menu repository work.

## Testing

**SQL guards** — a `cash_guards.sh` suite in the shape of the existing
`menu_write_guards.sh`:

- A waiter cannot insert into `cash_movements` directly; RLS blocks table writes.
- A cashier can `record_cash_movement` and cannot `approve_cash_movement`.
- A manager can approve and reject.
- A movement against another tenant's session is rejected.
- `record_supplier_payment` with `method = 'cash'` and no open session raises,
  and leaves no orphan `supplier_payments` row.
- A rejected movement is excluded from expected.

**Expected math** — table-driven tests against a seeded session. The acceptance
case is the real 2026-08-14 shift:

```
float 4,350 + sales 3,080 - payouts 3,655 = 3,775
counted 3,775 -> variance 0
```

If that does not come out to zero, the calculation is wrong.

**Flutter** — repository tests plus one integration test on the simulator:
record a payout, verify the row and its status, mirroring
`menu_edit_device_test.dart`.

## Migration order

Forward-only, one file each:

1. `supplier_payments`, `cash_movements`, enums, indexes, RLS.
2. `refunds.method`, backfill, updated `refund_payment()`.
3. New RPCs; rewritten `close_cash_session`.
4. Drop `purchase_orders.total_cents`.
5. Add the `cash.approve` permission key and backfill it onto existing system
   owner and manager roles.

## Backfilling 2026-08-14

The session is already closed with `expected 4,320, counted 3,775, variance
-545`. Those numbers stay. Rewriting a closed session's recorded count would
falsify a physical count that a person actually performed.

The day's purchases are instead entered as `supplier_payments` so inventory and
payables are correct going forward:

| Supplier / item | NPR |
|---|---|
| Mata Suppliers — tissue, mint flavour, coil, plastic | 2,450 |
| Xtreme 6 + Surya pack | 955 |
| Wai Wai Chow Chow | 20 |
| Lemon | 200 |
| Sikhar Ice x2 | 30 |
| **Total** | **3,655** |

The -545 stands as a day-one artifact, annotated as such.

The next session opens at a float of 3,775. The 30 NPR discrepancy noted during
reconciliation was cash already in the drawer that went uncounted at the
previous open; the 3,775 physical count is correct and absorbs it.

## Rollout

Migrations, then web UI, then Flutter. The web surface is usable before the
Flutter work lands; Flutter is additive and blocks nothing.
