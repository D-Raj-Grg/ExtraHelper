# TASKS — ExtraHelper

> Check this before starting work. Mark tasks done immediately (`[x]`). Add newly discovered tasks under the right milestone (or Backlog). Milestones map to `PLANNING.md` §6. Full spec: PRD.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (see Open Questions)

---

## Adding items after the bill is up (2026-08-16, web + DB)

A table asks for the bill, then orders one more water. There was no way to add it — the line got
dropped or the bill was rebuilt by hand. Two separate blocks, and the first was the bigger one.

### Block 1 — the web POS refused to add to any *fired* order

`components/pos/amend-flow.tsx` gated adding on `EDITABLE = ["draft","placed"]`, which flowed into
`addDisabled` → `dish-step` → `menu-tile`, rendering **every dish tile disabled and greyed with no
explanation**. Stricter than the database (which only ever refused `billed|closed|cancelled`) and
stricter than Flutter, which has shipped "Send new items" on a served order all along. So a waiter
on the phone could add a round; the same person on the web till could not, and the UI said nothing.

### Block 2 — `billed` was terminal

`amend_order_add_item` / `amend_order_add_custom_item` refused `billed` outright, on the reasoning
that a billed order is settled. It isn't: `create_bill_for_order` sets `orders.status = 'billed'`
and `bills.status = 'open'`. **Billed means a bill was generated, not that anyone paid.** No
`reopen_bill` / `void_bill` existed anywhere — `reopen_po` is the only reopen in the schema.

- [x] `20260816090000_amend_billed_unpaid_order.sql` — the guard moves off the order status and onto
      the bill, where the money actually is. `closed`/`cancelled` still refuse; `billed` passes only
      while the bill is `open` **and** has no `completed` payment (belt and braces: the status is the
      declared state, the `payments` probe catches a bill left `open` after a payment row landed).
      On success: `recompute_bill` in the same transaction, plus a `billed_order_amended` audit row.
      Permission gates untouched. Verified on prod: one row per function (no overload from
      `create or replace`), `security definer` intact, `authenticated` yes / `anon` no.
- [x] `ORDER_DETAIL_SELECT` carries `bills!orders_bill_id_fkey(id, status)` — the client could not
      tell unpaid from settled without it, so it had to refuse every add.
- [x] `amend-flow` splits the two questions it used to conflate: `unfired` picks which footer button
      shows, `addable` mirrors the DB rule. A "Send N new items" button re-fires (safe — `fire_order`
      only tickets lines with no `kot_item`, and only bumps status from `draft|placed`), and a
      blocked grid now says why instead of sitting there dead.
- [x] Entry points: "Add items" on the checkout Items card (`!settled`) deep-linking to
      `/pos/{orderId}`, and on the Completed tab for `billed` + bill `open`.
- [x] `addItem`/`addCustomItem` also revalidate `/bill/{id}` — the cashier who asked for the line is
      usually standing on it. The "already taken a payment" error passes through verbatim, because
      "start a new order for the table" is more use than a generic "this order is closed".

### Decisions worth not relitigating

**No reopen ceremony.** Adding straight to the billed order beats a Reopen → add → re-bill dance
mid-rush. The stale-print warning (`bill_printed_total_cents <> total_cents`) already existed for
exactly this case and now fires on its own — checkout has always said *"Nothing is locked by
printing — a table that orders another round after asking for the bill is normal."*

**Money is the lock, not the printout.** Once any payment lands, the answer is a new order; the
existing `add_order_to_bill` merge path covers combining it back onto one total.

### The money bug this opened, and the fix

Caught on review, before anyone used it. Adding goes through the RPC, which recomputes — but the new
line lands `status = 'draft'`, and that re-opened two plain table writes that could never previously
run against an order with a bill:

| action | filter | recompute? | result on a billed order |
|---|---|---|---|
| `setLineQty` | `status in (draft, placed)` | no | step the water 1 → 2, guest charged for 1 — **undercharge** |
| `removeItem` | **none at all** | no | delete a mistyped line, charge stays — **overcharge** |

Silent both ways: `bill_items` and `bills.total_cents` keep describing an order that no longer exists.

- [x] `20260816103000_open_bill_follows_its_lines.sql` — `trg_order_item_sync_bill`, an
      `after insert or update or delete` row trigger on `order_items` that recomputes the parent bill
      **while it is `open`**. Fixing the two callers instead would have left the same hole for Flutter,
      for the offline queue replaying a stale edit, and for anything hitting PostgREST directly. The
      invariant is "an open bill equals the sum of its lines", so it belongs on the table, not in two
      server actions. `security definer` is required — `recompute_bill` has EXECUTE revoked from
      `authenticated`. Verified on prod: trigger live, not executable by `authenticated`, and zero
      drift across every existing open bill.
- Deliberately narrow: an order with no `bill_id` costs one indexed lookup and returns. A `partial`,
  `paid` or `void` bill is money already counted and is never rewritten from here — the RPCs allowed
  to touch a settled bill (`void_order_item`, `refund_payment`) still do their own recompute.

### The composer opens *over* the bill, it does not replace it

First cut deep-linked "Add items" to `/pos/{orderId}`. Wrong: it threw away the bill the cashier was
mid-settle on, and closing the composer there ran `router.replace("/pos")` — landing on the board,
nowhere near where the work started. Changing screens to add one water bottle is not a POS.

- [x] `new-order-provider.tsx` already mounted the create composer as a dialog over *any* page (it
      exists so "New order" works from the cash drawer or a report). Taught it amend as well:
      `openAmendOrder(orderId)` beside `openNewOrder(tableId?)`, sharing one `beginOpen()` for the
      lazy composer fetch, warm cache start and stale-response guard.
- [x] `AmendPane` exported from `order-modal.tsx`, and `AmendFlow`/`AmendPane` widened from `PosData`
      to `PosComposerData` — amending needs the menu and the pickers, not the board's orders, so it
      no longer depends on /pos having loaded. `PosData` satisfies it structurally, so /pos is
      unchanged.
- [x] Checkout's button calls the hook instead of rendering a `Link`. The provider's `close()`
      already does `router.refresh()`, which is what brings the recomputed total back to the bill.
- [x] "Finish the bill" in the composer footer now closes the dialog as well as navigating — the pane
      renders in two places now, and over the bill it would have changed the route underneath an
      open dialog.

### Charged before it was fired — and sometimes never fired

The sharpest bug of the lot, found by reviewing the finished work. `recompute_bill` sums every line
that isn't void; **status doesn't come into it**. A line added by the amend RPCs lands `draft`, and
firing is a *separate* tap. So on a billed order the bill rose the instant a waiter tapped a dish —
and if they backed out, got distracted, or the app died, the guest was charged for something with no
KOT at all. No ticket existed to be missing, so nothing downstream could catch it. The KDS fix below
does not cover this: it is about tickets, and a draft line has none.

- [x] `20260817090000_billed_amend_fires_and_split_syncs.sql` — when the order is already `billed`,
      both amend RPCs now `fire_order_kots` in the same transaction that charges. Re-fire is safe by
      construction: only lines with no `kot_items` are ticketed, and the status promotions are scoped
      to `('draft','placed')`, so the order stays `billed` and nothing cooking reprints. Composing a
      *fresh* order still batches — that is what a cart is for, and nothing is charged yet.
- [x] Same migration: `trg_sync_open_bill` only ever resolved the bill from `new.order_id`, so
      `split_order_items` — which moves a line onto a brand-new order with a null `bill_id` — made it
      return early and **left the source bill charging for a line that had moved to another tab**.
      An UPDATE now syncs both sides.
- [x] `amend-flow.tsx` — "Generate bill" is disabled, with a reason, while unfired lines exist. The
      widened add rule made it possible to add to a `ready`/`served` order, which put "Send N new
      items" and "Generate bill" side by side; `_build_bill_for_order` snapshots draft lines too, so
      billing first charged for food the kitchen had never been told about.
- [x] Flutter `checkout_screen.dart` — `_busy` now spans the push **and** the awaited refresh.
      `BillSnapshotNotifier.refresh()` deliberately keeps the old data on screen while re-reading, so
      clearing busy early left "Take payment" live over the pre-amend total, with the payment sheet
      seeded from the stale `dueCents` — one quick tap and the bill settles short. Cleared in a
      `finally` so a failed refresh can't strand the screen.
- [x] Flutter — `_addItems` re-checks `PosOrder.isAmendable` on the freshly-read row before pushing
      (it was dead code; the snapshot can predate a payment taken on another terminal).

### A ticket on a billed order is work in hand, not history

Found by the Flutter test pass, and it is the sharpest edge of the whole change: **food charged and
never cooked.**

Both clients decided a KOT was finished partly from its *order's* status, treating `billed` as done.
That was written when `billed` was terminal, and its own comment gave the game away — *"a `ready`
ticket on a **paid** bill is history"*. `closed` is the status that means paid. Now that a billed
order can take a new round, firing it makes a real ticket on an order that stays `billed`.

- [x] `lib/pos-constants.ts` — new `KOT_HISTORY_ORDER_STATUSES = ["closed", "cancelled"]`;
      `isKotCompleted` uses it instead of `ORDER_DONE_STATUSES`. Fixes the POS KOT tab and its badge.
- [x] `extrahelper_flutter/lib/data/supabase/kds_repository.dart` — same fix on `isCompleted`, and
      this one was the dangerous instance: Flutter's KDS filters on the order's status, so the new
      round was **hidden from the kitchen board entirely**. Tests updated (`kds_test.dart`), plus a
      new case pinning "a new ticket on a billed order is work in hand, not history".
- The **web** KDS was never affected — `app/(app)/kds/page.tsx` filters on `kots.status` alone.

### Caught on adversarial review, fixed same pass

- [x] **"Send new items" wasn't gated on `addable`.** `fire_order` checks tenant membership and
      nothing else, so on a paid-and-closed order still carrying a draft line somebody added and
      never sent, the button rendered *under* a "this bill is paid" notice and cooked an item no
      bill would ever charge for. Now `addable && newItemCount > 0`.
- [x] **Merged bills sent the round to the wrong table.** The bill page's order query is
      `.order("created_at").limit(1)`, so "Add items" always deep-linked to the *oldest* order.
      Tables 5 and 6 merged onto one bill, table 6 orders another round → line lands on table 5's
      order → KOT prints **Table 5** → runner delivers to the wrong table. The button now renders
      only when the bill has exactly one order behind it; a merged bill sends the cashier to /pos to
      pick the tab deliberately.
- [x] **Checkout button gated on `!settled`**, which is `status !== 'paid'` — so it also showed on
      `partial` and `void` bills and dead-ended in a greyed composer. Now gated on `open`, matching
      the RPC.
- [x] **The blocked-grid notice said "This bill is paid"** for part-paid bills, voided bills, and
      closed orders with no bill at all. A caption that lies is worse than none — it now names the
      actual state.
- [x] **Custom item ignored the gate.** The dish grid greyed out under a "start a new order" notice
      while the Custom item button beside it stayed live and round-tripped to the server for its
      refusal. `addDisabled` now threads through to `CartRail`.
- [x] Completed tab no longer shows a stale count/total for the row just amended (realtime caught up
      a beat later; `close()` now closes the visible gap).

Also fixed incidentally: the old footer rendered **"Generate bill"** on a `cancelled` order.

### Smaller review fixes

- [x] `kot-tab.tsx` `canCancel` still tested `ORDER_DONE_STATUSES`, so a ticket that the new rule
      correctly puts on the **live** pass had its cancel control greyed out. `void_order_item`
      recomputes for any bill that isn't `paid`, so voiding there is fully supported — cooks were
      looking at work with the one control that clears it disabled. Now uses the same history set.
- [x] `new-order-provider.tsx` — the dialog stays mounted through its 200ms exit animation and
      `close()` clears `amendOrderId` in the same batch, so every amend close repainted as the **New
      order** composer, table picker and all, on the way out. Body gated on `open`.
- [x] Flutter — the "More for this table" card is gated on eligibility, the button on readiness, so
      it stops appearing and disappearing (shifting the layout) during a print. `repo.order()` gained
      the same 6s cap every other tap on that screen has.
- [x] Stale comment in `kds_providers.dart` still describing the old billed-is-history rule.

### Known and accepted

- **A `ready` ticket on a billed-but-never-paid order now stays on the pass.** That is the
  pathological case only — paying sets the order `closed`, which clears it. The residency window is
  "bill printed, table walked", which is exactly when staff *should* still see it. `set_bill_complimentary`
  zeroes a total while leaving the bill `open`, so that one lingers too. If it ever bites, the fix is
  a day floor on the live KOT query, not putting `billed` back.
- **Migration filenames don't match the applied versions.** The live
  `supabase_migrations.schema_migrations` rows are `20260816033337_amend_billed_unpaid_order` and
  `20260816034449_open_bill_follows_its_lines`; the repo files carry later timestamps. All are
  idempotent (`create or replace`, `drop trigger if exists`) and relative order is preserved, so a
  re-apply is harmless — just don't expect the numbers to line up.
- **The explicit `recompute_bill` in the amend RPCs is now redundant** with the trigger (the insert
  fires it first). Kept as belt and braces; it costs one extra rebuild per add.

### Fallout / follow-ups

- [x] **Flutter parity — shipped 2026-08-16**, same day. See `../extrahelper_flutter/TASKS.md`. The
      block turned out to be *navigational*, not a flag: nothing on Flutter's add path ever consulted
      `isClosed` (`cart_controller.dart:32` — "the server has the final say"), so the work was the
      checkout entry point, not a getter. Original checklist kept below for the record:
      1. `pos_repository.dart:143-148` — add `bills!orders_bill_id_fkey(id, status)` to `_orderSelect`
         (covers `activeOrders()`:158 and `order()`:226). `_completedSelect`:194 already has it.
      2. `models.dart:345,397` — `PosOrder.billStatus`, parsed from the embed (copy `PosCompletedOrder`:269).
      3. `models.dart:379` — keep the three-status getter as `isSettled`, add `isAmendable`.
      4. `order_composer.dart:423` — point the **Cancel order** gate at `isSettled`. Do **not** relax
         it: `cancel_order` still refuses a billed order.
      5. `pos_repository.dart:719` — `_friendly` needs an `'already taken a payment'` branch; today
         the raw lowercase Postgres string is shown.
      6. `bill_repository.dart:100-109` already fetches the primary order and throws the `id` away —
         carry it onto `BillSnapshot` and add `canAddItems => bill.isSettleable && payments.isEmpty`.
      7. `checkout_screen.dart:~620` — "Add items" above the existing `MergeCard`, gated on
         `live && canAddItems && order.create`; refresh `billSnapshotProvider` on return.
      8. `pos_screen.dart:140-157` — on the `bill_requested` fall-through (offline / 6s timeout) the
         tap still seeds a *second* order on a table mid-payment. Prefer `activeOrderIdForTable`
         (`pos_repository.dart:496`), which already finds billed orders on purpose.
      9. Tests: `cart_test.dart:252` and `order_actions_test.dart:59` encode the old rule and must
         split; add cases to `checkout_screen_test.dart` and `outbox_test.dart`.
- [ ] **Live behaviour change in Flutter today, app unmodified.** Nothing on its add path ever
      consulted `isClosed` (`cart_controller.dart:32` — "the server has the final say"), and
      `repo.order()` has no status filter. So if another device bills a table while a waiter has the
      composer open, adds that the server used to bounce now succeed and reprice the bill — with no
      warning band and no bill refresh. Not data-corrupting (the trigger above keeps the total
      honest), but the waiter isn't told. Worth the warning band early.
- [ ] `updateLine` still has no status filter — notes/course/seat only, so no money moves, but it
      can edit a fired line's row on a billed order. Left alone deliberately.
- [ ] `menu_tile.dart:54` has a `disabled` param documented as "the order is fired/billed — no
      longer addable" that is **never passed**. Dead API; delete or wire, don't leave it ambiguous.
- [ ] `components/bill-view.tsx` (~400 lines) has **zero importers** — a dead second checkout surface
      that will silently drift from `CheckoutView`. Delete it.
- [ ] Flutter `_openTable` has no re-entrancy guard (unlike `_billOrder`'s `_billing` flag) and now
      chains up to four 6s-capped hops on one tap. A waiter who taps again mid-wait gets two composers
      pushed on the same order. Add the guard and a progress indication.
- [ ] A line added to a billed order is inserted `status = 'draft'`, so it still needs firing. The
      "Send new items" button is the only thing standing between that and charging a guest for
      something the kitchen never saw — worth an auto-fire or a louder nag if it bites anyone.

---

## Purchasing rebuild + write guards (2026-08-15, web + DB)

The screen could create and receive, and nothing else: suppliers were read-only chips, no record
could be edited or removed anywhere, and every order rendered fully expanded forever in one flat
stack. Auditing it turned up something worse than the missing buttons.

### The hole

`suppliers`, `purchase_orders`, `po_items`, `inventory_items` and `stock_movements` each carried
one policy — `tenant_all`, `for all to authenticated`, predicated on tenant membership alone, with
no role or permission test. Any active member could `DELETE /purchase_orders?id=eq.X` or invent a
500kg flour delivery straight through PostgREST. Same hole `20260814170000_menu_write_guards.sql`
closed on the menu tables, from the same generic applier (`20260710095505_rls_helper.sql`), never
narrowed here.

- [x] `stock_movements` read-only to clients (`20260815041554`). Shipped **alone and first** — every
      writer is already a definer RPC, so it was the one change that could not break a screen.
- [x] `suppliers.archived_at`, `supplier_payments.voided_at/by/reason`, `purchasing.delete`
      permission, unique index on `po_items(po_id, inventory_item_id)` (`20260815041725`).
- [x] PO lifecycle + line RPCs (`20260815041915`): `create_po`, `send_po`, `reopen_po`, `cancel_po`,
      `delete_po`, `add_po_line` (upsert), `update_po_line`, `delete_po_line`,
      `correct_po_receipt`, and the `assert_may_edit/delete_purchasing` gates.
- [x] `delete_supplier`, `void_supplier_payment`, `supplier_balances` v2, `purchasing_summary`
      (`20260815042232`).
- [x] Write guards (`20260815043411`) — applied **last**, with the rewritten actions, because
      creating a supplier and adding a line were direct writes until then.
- [x] Rebuilt `/purchasing` as Orders / Suppliers / Payments over a summary strip.

### Decisions worth not relitigating

**Three refusals are deliberate**, and each explains itself instead of failing with a database error:

- Cancelling an order that has received stock. `supplier_balances` excludes cancelled orders, so
  the money owed would vanish while the goods stayed on the shelf.
- Deleting one. `stock_movements.reference` is plain text, not an FK, so the movements would
  survive as orphans pointing at a dead id while `current_qty` kept the stock forever.
- Voiding a cash payment whose shift is already closed. That shift's expected and variance are
  frozen by design; the message points at a correcting cash-in instead.

**Corrections are corrections, not undos.** `correct_po_receipt` writes a compensating `adjustment`
movement carrying the delta, referenced `po-correct:<id>`, and leaves the original receipt in
place. It does **not** restore `cost_cents` — receiving overwrote it and the prior value was never
stored, so reconstructing it would be a guess presented as a fact.

**`purchasing.delete` is withheld from the inventory role.** `default_role_permissions` hardcodes
that role's list, so a new key never reaches it — which is what we want: the store keeper who
raises orders must not be able to erase a supplier the books reference or reverse a receipt.

**Archiving hides a supplier from pickers, never from a debt.** `supplier_balances` still returns
archived suppliers, and the summary strip still counts what they are owed.

**`sent` and `cancelled` were dead rendered statuses** that nothing could set. Kept and made
reachable rather than removed: `sent` is already load-bearing in `create_draft_po_from_reorder`,
which treats draft/sent/partial as "open", and it is the honest boundary that freezes lines.

### How a refusal shows up — read this before writing a guard test

Where a table keeps a write policy, RLS **filters rows**: an unauthorised UPDATE or DELETE affects
0 rows and raises nothing. Where the grant itself is revoked, the caller gets `42501`. Both are
refusals; only the second is loud. A test that asserts only on exceptions will report a false
failure — as one did during this work. **Assert row counts too.**

### Verification (2026-08-15, live tenant, JWT impersonation)

- 5/5 `stock_movements` lockdown: kitchen and owner both refused write, reads open.
- 12/12 lifecycle: duplicate line merges, sent freezes lines, cancel and delete both refused once
  stock is received, correction moves stock by exactly the delta while the original movement
  survives, correction without a reason refused, correction requires `purchasing.delete`.
- 10/10 supplier and void: delete-before-archive refused, archived-and-unused deletes, supplier
  with payments refused by name, archived supplier still shows its debt, double void refused.
- 14/14 write guards: kitchen refused on every write to all five tables; owner still edits
  suppliers, creates ingredients and raises orders via RPC; reads open on all five; data intact.
- `tsc --noEmit`, `eslint` clean on touched files, `npm run build` compiles.

### Also fixed along the way

- `create_po` never set `branch_id`, so every UI-created order had none — and
  `record_supplier_payment` reads its branch from the order, so every cash payout was stamped with
  no branch. Fixed in the RPC and backfilled.
- Purchasing actions used `requireRole` (base role) while the page used `requirePermission`. A
  custom role built on `inventory` with `purchasing.edit` revoked still passed. All on the
  permission now.
- The orders query fetched every order with every nested line, unbounded. Paged at 25, defaulting
  to open, with line detail fetched when a row opens.

### Open follow-ups

- [ ] **`inventory_items.current_qty` is still client-writable**, narrowed only to `inventory.edit`.
      A store keeper can set a quantity with no `stock_movements` row behind it. Closing it needs a
      trigger that can distinguish a definer caller, and would break `createInventoryItem`'s
      opening-stock insert. Its own task.
- [ ] Supplier "Local Purchase" is a placeholder for the non-Mata 14 Aug goods; rename if they came
      from a named shop. Supplier "14 Aug" and its empty draft order are an earlier manual attempt,
      left alone deliberately.
- [ ] No unique constraint on supplier name — the live tenant has near-duplicate junk rows, and a
      migration-time failure would be worse. A soft warning in the create form is the right level.

---

## Cash movements & supplier payments (2026-08-15, web + DB)

The first real shift at The Sekuwa Station exposed a hole: `close_cash_session` only ever *added*
cash sales to the opening float, so every rupee that left the drawer read as an unexplained
shortfall. That day opened on 4,350, paid out 3,655 in cash purchases, took 3,080 in cash sales and
counted 3,775. The app reported `expected 4,320 / counted 3,775 / variance -545` — two large
unrecorded flows that nearly cancelled. The variance detected neither.

Design: `docs/superpowers/specs/2026-08-14-cash-movements-and-supplier-payments-design.md`
Plan: `docs/superpowers/plans/2026-08-14-cash-movements-backend-and-web.md`

- [x] `cash_movements` + `supplier_payments`, enums, indexes, RLS select-only
      (`20260815090000`). `cash_movements` means strictly one thing: physical cash in or out of the
      POS drawer. `session_id` is NOT NULL — cash cannot leave a drawer that is not open.
- [x] `cash.approve` permission + backfill onto system owner/manager roles (`20260815090100`).
      **Could not reuse `cash.manage`:** the cashier role already holds it, so approval would have
      been a cashier signing off their own payout.
- [x] `record_cash_movement`, `approve_cash_movement`, `reject_cash_movement` (`20260815090200`).
- [x] `record_supplier_payment` (cash writes its drawer payout in the same transaction) and
      `supplier_balances` — received value minus payments, derived not stored (`20260815090300`).
- [x] `refunds.method` + `refund_payment` dropped and recreated at 4 args (`20260815090400`).
      Backfill covers single-tender bills only; null stays non-cash.
- [x] `close_cash_session` rewritten (`20260815090500`): auto-approves pending movements, then
      `expected = float + cash sales - cash refunds - payouts + paid_in`.
- [x] Dropped `purchase_orders.total_cents` (`20260815090600`) — never written by anything, always
      read 0.
- [x] `payment_method` gains `other` (`20260815090700`) for supplier money that never touched the
      till. Absent from `PAYMENT_METHODS`, so it is never offered at checkout.
- [x] Cash drawer UI: movements panel, cash out / cash in dialog, approve + reject.
- [x] Purchasing UI: quick purchase, PO payments, payables block.
- [x] Backfilled 2026-08-14: Mata 2,450 as a quick purchase; Xtreme 6x110, Surya 1x295, Wai Wai
      1x20, Lemon 1kg x200, Shikhar Ice 2x15 as inventory + PO + GRN. Total 3,655.

**The open-session UI must never show expected, cash sales, or anything derived from them.**
`components/cash/session-card.tsx` already tells the user expected is withheld until submit "so the
count stays honest". A cashier who can see expected can tune the physical count to match it, which
drives variance permanently to zero and destroys the only signal this feature produces. Movement
amounts are safe — the cashier handed that money over and already knows it.

**Auto-approve at close is a deliberate loosening.** Approval is a review step, not a hard control:
anything still pending when the shift closes is approved rather than stranding a cashier at 11pm.
`auto_approved` marks those rows so an owner can scan for them. The upside is that a closed session
is final — no closed session ever needs recomputing.

### Verification (2026-08-15, against the live tenant)

Applied with the Supabase MCP `apply_migration` — this project has no `supabase/config.toml` and no
CLI link, so `npx supabase db push` does not work here. Guards were driven by JWT impersonation
(`set local role authenticated` + `request.jwt.claims`) rather than the bash suites, which need
credentials nobody has set and a cashier account that does not exist.

- 4/4 RLS: direct inserts refused 42501 for owner and kitchen; members can select.
- 3/3 permissions: cashier keeps `cash.manage`, does **not** get `cash.approve`; owner/manager do.
- 9/9 movement RPCs: record, approve, reject, zero amount, blank note, no-session, and a user
  without `cash.approve` refused 42501.
- 10/10 supplier payments, including atomicity — a cash payment with no open session raises and
  leaves **no** orphan `supplier_payments` row.
- 8/8 close: the 2026-08-14 shift replayed to `expected 377500, variance 0`; a session with no
  movements still closes to float + cash sales; rejected movements excluded.
- 8/8 backfill: 3,655 recorded, 5 stock movements from the PO, none from the quick purchase.
- `tsc --noEmit` clean, `eslint` clean on every touched file, `npm run build` compiles.

### Review pass (2026-08-15) — three defects found and fixed

- [x] **Cross-tenant session lookup.** `record_supplier_payment` took its tenant
      from the supplier but found the open drawer by `cashier_id` alone. One open
      session per cashier *per tenant* is allowed, so a user in two tenants could
      write a `cash_movements` row stamped tenant A pointing at tenant B's
      session — and `close_cash_session` sums by `session_id`, so B's drawer
      would have been debited for A's purchase. Latent (no user is in two
      tenants), fixed in `20260815041500`: both RPCs now filter the session by
      tenant, `record_cash_movement` takes `_tenant` explicitly rather than
      guessing, and a `before insert or update` trigger refuses any movement
      whose tenant does not match its session.
- [x] **Shift report auto-approved marker was never built.** The spec called it
      the compensating control for auto-approve-at-close and `shift-reports.tsx`
      had no trace of it. Added: a Cash out column with payouts, paid-in, and a
      ⚡ count of entries the close approved rather than a manager.
- [x] **Migration filenames did not match the applied versions.** `apply_migration`
      stamps its own timestamp, so the repo said `20260815090000…` while the
      registry said `20260815031948…`. Files renamed to the registered versions
      so a fresh environment sees them as already applied.

### Open follow-ups

- [ ] **Flutter surface** — repository, providers, movements panel, `cash.approve` gating, and a
      simulator integration test. Its own plan, deferred until these RPC signatures settled.
- [ ] **Refund method picker** (web + Flutter). Refunding a **split-tender** bill now raises rather
      than guessing the tender. Rare, and the message names the fix, but the UI should ask.
- [ ] **`record_cash_movement`'s `cash.manage` check is untested** — unreachable for default roles,
      since only owner/manager/cashier can open a session and all three hold the key. It only bites
      a custom role with it revoked.
- [ ] `20260814180000_digital_payment_methods.sql` is applied but **missing from
      `supabase_migrations.schema_migrations`** (it went in via raw SQL). Harmless — its statements
      are idempotent — but a fresh environment replays it.
- [ ] Duplicate tenant `6a290e99-...` also named "The Sekuwa Station", no sessions. Left alone.
- [ ] Empty draft PO + supplier "14 Aug" (`73957319-...`) from an earlier manual attempt. Left alone.
- [ ] "Local Purchase" is a placeholder supplier for the non-Mata goods; rename it if they came
      from a named shop.

---

## Digital payment methods — eSewa, FonePay, bank (2026-08-14, both clients)

Nepal restaurants settle most non-cash bills through a wallet or bank QR the guest scans. Added
`esewa`, `fonepay`, `bank` to the `payment_method` enum
(`20260814180000_digital_payment_methods.sql`) alongside the `wallet` and `points` that already
existed.

**These are record-only.** Nothing is charged: the guest scans, shows the confirmation, the cashier
records what arrived — the same trust as a card on a terminal. That is what makes them safe on the
phone (unlike `online`, which charges through the gateway adapter and has no RPC behind it) and what
lets them **queue offline exactly like cash**. `online` is still the only connection-gated method.

`record_payment` gained `_reference text default null` → `payments.reference`, the guest-side
transaction id that makes a digital payment reconcilable against the provider's statement. The
column had existed since the billing migration and was never written. Arity changed, so the function
was **dropped and recreated**, with `revoke`/`grant` re-issued naming the full 5-arg signature. The
4-arg named call still resolves via the default, which is what keeps an offline replay queued by an
older build working.

- [x] Migration: enum values + `record_payment` with `_reference` (trimmed, `''` → null, 120 cap).
      The migration drops **both** the 4-arg and the 5-arg signature before creating: dropping only
      the old one leaves the new one standing on an already-migrated database and `create` fails
      with "function already exists" — i.e. the next `db push` breaks. Proven re-runnable in a
      rolled-back transaction.
- [x] `payByCard` stores the gateway's charge id in `reference` too. It is **truncated, not
      validated**: the card is already charged by then, so a reference the RPC refuses (22001)
      would fail the recording of money already taken.
- [x] `lib/payment-constants.ts` — one catalogue (label, icon, `needsOnline`, `takesReference`).
      Also fixes an existing rule violation: reports printed the raw enum through `capitalize`, so
      `online` read as "Online" and `esewa` would have read as "Esewa".
- [x] Web: checkout panel, bill view, split tenders, offline queue payload, reports, receipt,
      invoice preview and the printed bill doc all go through the catalogue.
- [x] Flutter: `paymentMethods` list, labels, reference field on the payment sheet, `PaymentIntent`
      carries it, `bill_repository.recordPayment` passes `_reference`.
- [x] `supabase/tests/payment_methods.sh` — 18 assertions. **Needs credentials + a scratch OPEN
      bill (`OPEN_BILL`, `FOREIGN_BILL`) to run; not yet run against a live project.**
- [x] Verified directly in rolled-back transactions against the demo tenant: all four new methods
      record; reference stored trimmed; blank stored as null; replay under the same key does not
      double-charge; over-long reference `22001`; unknown enum `22P02`; foreign tenant `42501`.

**Not built** (deliberate): real eSewa/FonePay gateway APIs — the adapter registry in
`lib/integrations/payments.ts` is where those land, under their own keys, without touching billing
code. No per-tenant toggle of which methods show. `cash_sessions` untouched, so digital correctly
stays out of the drawer count.

---

## Manager ops moved into Postgres (2026-07-27, mobile Milestone G)

`set_item_86(_item_id, _is_86)` and `set_table_state(_table_id, _state)` — migration
`20260727120000_manager_ops.sql`. Both `security definer`, `search_path = public`, revoked from
`public, anon`, granted to `authenticated` by full signature.

**Why:** RLS on `menu_items` and `restaurant_tables` is tenant-scoped only. The role checks lived in
`toggleItem86` and `setTableState` as `requireRole(...)`, so any member of the restaurant could do
either update straight through the API. The guard was in the client. Both RPCs now hold the rule,
mirror the previous role sets exactly (86 = owner/manager/kitchen; state = owner/manager/
receptionist/waiter/cashier), and write an `audit_logs` row — which the column updates never did.

`set_table_state` additionally **refuses to free a table that still has a live order**. That was
possible before and hid the order from the board while the kitchen was still cooking it.

- [x] `app/(app)/menu/actions.ts` → `toggleItem86` calls the RPC.
- [x] `app/(app)/tables/actions.ts` → `setTableState` calls the RPC.
- [x] `lib/supabase/database.types.ts` updated. `tsc` + `eslint` clean.
- [ ] Consider a dedicated `menu.86` permission key: the kitchen needs to 86 a dish but must not
      hold `menu.edit`, so the RPC currently checks the role directly. A catalog decision.

## Dashboard moved into Postgres (2026-07-30, mobile Milestone I)

`dashboard_summary(_tenant, _days)` — migration `20260730090000_dashboard_summary.sql`.
`security invoker` (RLS is still the boundary), `stable`, `search_path = public`, gated on
`has_permission(_tenant, 'reports.view')`, revoked from `public, anon`, granted to `authenticated`.

**Why:** the dashboard did six parallel PostgREST reads and then bucketed bills into tenant-local
days in TypeScript with `Intl.DateTimeFormat`. Flutter can't reproduce that — `package:intl` ships
no IANA timezone database — so the mobile owner dashboard would have needed a second implementation
of "which day is this bill in", i.e. exactly the drift rule 1 exists to prevent. Postgres owns
`tenant_settings.timezone`, so the aggregation lives there and both clients render one payload.
Timestamps come back pre-formatted in the tenant's zone (`to_char`) for the same reason.

The RPC **returns null instead of raising** when the caller lacks `reports.view`, so a surface can
degrade rather than explode.

- [x] `app/(app)/page.tsx` calls the RPC; ~90 lines of query + bucketing deleted.
- [x] `lib/supabase/database.types.ts` updated. `tsc` + `eslint` + `next build` clean.
- [x] **Verified**: today revenue, today bill count and the 30-day series sum match a direct
      tz-aware query to the cent; 30 buckets for a 30-day window; a non-platform-admin owner of
      tenant A gets null for tenant B.
- [x] **Behaviour change, owner-confirmed 2026-07-30:** `/` previously showed revenue, low stock and
      recent payments to *every* member of a restaurant — the page only called `requireTenant()`,
      which was a real leak. It is now gated on `reports.view` like the rest of reporting, and roles
      without it see a "no access to reports" card. If a non-reporting role ever needs one figure
      off this screen (low stock, say), that is a separate narrower RPC — never reopening revenue.

## Inventory ops moved into Postgres (2026-07-30, mobile Milestone J)

Migration `20260730214500_inventory_ops.sql`.

**`adjust_inventory` had no authorization whatsoever.** It was `security invoker` with no
`has_tenant_role` and no `has_permission` in its body, and RLS on `inventory_items` /
`stock_movements` / `stock_counts` / `stock_count_items` is tenant-scoped only — so the
`requireRole("owner","manager","inventory")` in `app/(app)/inventory/actions.ts` was the *only*
guard, and anyone in the restaurant could move stock or log a waste write-off straight through the
API. The comment on that call claimed "RLS + role enforced inside"; it did not. Third instance of
the same class in three milestones, after 86/table-state (G) and revenue (I).

- [x] `adjust_inventory` → `security definer`, gated on `has_permission(_tenant, 'inventory.edit')`
      (the same holders as the old role list, so nothing regressed), and it now writes an
      `audit_logs` row — `stock_adjust` / `stock_waste` with the item, delta, reason and resulting
      quantity. That audit row is the **only** attribution that exists: `stock_movements` has no
      actor column.
- [x] **Order of operations, not just the guard.** The old body took the tenant from the update
      itself (`update … returning tenant_id`), which was safe only because RLS fenced the update.
      Under DEFINER that writes another tenant's row and asks afterwards. Now select → guard →
      update. **Verified**: a non-platform-admin owner of tenant A passing a tenant-B item is
      refused `42501` and the B row does not move.
- [x] **`set_stock_count_actual(_count_item_id, _actual)`** — new, DEFINER, `inventory.edit`,
      refuses a posted count, returns the variance. Replaces the direct `stock_count_items` update
      in `setCountActual`, which any member could have made against any count in their restaurant.
      Note `variance` is a **generated column** (`actual_qty - theoretical_qty`) — writing to it
      raises `428C9`, which is exactly how the first version of this function failed.
- [x] `post_stock_count` audits the posting itself (`stock_count_post`).
- [x] `inventory_items.barcode` + a **partial unique index per tenant** where set. Barcode field
      added to `components/inventory/item-sheet.tsx` (create and edit) — the mobile scanner has
      nothing to match without it — and the raw constraint name is rewritten into an instruction.
- [x] `database.types.ts` updated; `tsc` + `next build` clean.
- [x] **Verified live** as an impersonated non-admin owner: an authorized adjustment applies and is
      audited; a wastage carries its reason; a cross-tenant write is refused; a count line's
      variance computes, replays identically, and overwrites on recount; posting reconciles on-hand
      and writes a `count` movement; a posted count refuses further edits. All probe rows removed.

**One decision left open for the owner.** `start_stock_count` seeds every line's `actual_qty` with
the item's current on-hand, so **no line is ever "uncounted"** — which makes `post_stock_count`'s own
skip-uncounted-lines branch unreachable, and makes any "N of M counted" progress indicator a lie
(the Flutter app now reports how many lines *differ* instead). The clean fix is to seed null, but the
web count page does `Number(r.actual_qty)`, so null would render there as a counted **0**. That is a
two-client change and was deliberately not made half-way. See `../extrahelper_flutter/TASKS.md`
Milestone J.

## `report_sales` — the guard fix #5 missed (2026-07-30)

Migration `20260730093000_report_sales_guard.sql`.

`20260712120000_report_fixes.sql` set out to "add `reports.view` permission guard to every report RPC
(direct-API defense)" and covered six of them — `report_sales_by_bill`, `by_category`,
`report_inventory`, `report_staff`, `report_customers`, `report_extras` — but **not `report_sales`**,
which is the one that returns the headline revenue figure. `bills` RLS is tenant-scoped only
(`tenant_all`) and `reports.view` is Owner/Manager only, so until now any member of a restaurant
could read the day's takings straight through the API. Same hole class as the dashboard leak above,
found while scoping mobile Milestone I.

- [x] Guard added. Same arity, so a plain `create or replace` — grants carry over, no re-issue needed.
      Verified live: `has_permission` present in `prosrc`.
- [x] ACL tightened: the original migration granted to `authenticated` and **never revoked**, so
      `public` (hence `anon`) held EXECUTE by default. Now `authenticated` only. Harmless in practice
      — `security invoker` + RLS gives anon no rows — but "revoke from anon alone does nothing" cuts
      both ways: the grant nobody wrote is the one that bites.
- [x] No regression: the only caller is `components/reports/sales-tab.tsx`, reached from
      `app/(app)/reports/page.tsx`, which already does `requirePermission("reports.view")`.

**Process note, worth more than the fix.** Two Claude sessions worked this milestone at the same time
against the same dev project. The second one wrote a `dashboard_summary(_tenant, _days, _tz)` while
this one's `(_tenant, _days)` was already live, which is the arity trap in `CLAUDE.md`: Postgres kept
**both** function objects, and a PostgREST call naming `{_tenant, _days}` matches either, so `/` would
have failed on an ambiguous function call. Caught and dropped ~14 minutes later; only one
`dashboard_summary(uuid, int)` exists now. Before adding an RPC, check `pg_proc` for the name — the
repo is not the whole truth about what is deployed.

## Single-environment decision (owner, 2026-07-31)

**One Supabase project is prod.** No dev/prod split, no staging project, no local Docker stack.
`ixrcdtwdcpsmlbocvejv` serves `https://extra-helper.vercel.app/`. Staging is deferred until after
launch, once the feature backlog settles — the owner's call, made knowingly.

**What it costs, so nobody rediscovers it the hard way:**
- **Every migration's first execution is against live data.** There is no rollback target and no
  place to rehearse. `CLAUDE.md`'s "use Supabase local/dev branch for tests" is suspended by this
  decision, not satisfied — treat it as re-read-the-SQL-twice instead.
- **The repo is not the truth about what is deployed** — now measured, see "Migration ledger drift"
  below. Before adding an RPC, check `pg_proc`; the repo will not tell you.
- **Free tier has no point-in-time recovery.** `bills` and `payments` are the tables that cannot be
  reconstructed. This is the strongest argument for Pro, stronger than the password item below.

**Launch gates — all must clear before the first real restaurant, none are code:**
- [x] **Repair the migration ledger** (see below) — done 2026-08-13. `db push` is no longer a loaded
      gun; every repo migration is recorded as applied.
- [ ] Clear the three test tenants. Measured 2026-07-31, all three are on prod:
      `d-raj` "The Sekuwa Station" (36 orders / 23 bills), `d-raj-a859` **same name, a duplicate from
      testing `provision_tenant(_force_new)`** (6 / 4), both owned by `clixacom@gmail.com`; and
      `demo-diner` "Demo Diner" (9 / 4) owned by `extrahelper.demo.owner@gmail.com`. Use Settings →
      Dangerous Area → `reset_tenant`. Then delete auth user `extrahelper.demo.owner@gmail.com`
      (`117c236d-c1dd-478e-9f03-645a540f8e08`) — a tenant wipe does **not** touch `auth.users`.
      (The slug `extrahelper-test-diner` this line used to name has never existed.)
- [x] Confirm `SUPABASE_SERVICE_ROLE_KEY` is server-side only, no `NEXT_PUBLIC_` prefix anywhere.
      **Verified 2026-07-31**: the only reference in the whole app is
      `app/api/webhooks/[gateway]/route.ts:31`, a route handler. Still set it in Vercel's env as a
      plain (unprefixed) variable — the prefix is what would leak it, not the name.
- [ ] Upgrade Supabase to Pro — buys PITR (see above) and unblocks leaked-password protection,
      which is `[!]` in the Backlog for exactly this reason.
- [ ] Drive the deployed site end to end (auth → POS → KDS → bill → pay). SSR cookie handling is the
      usual first casualty of local→Vercel drift, and it has never been exercised there.
- [ ] Pick the launch payment gateway + keys — the sandbox adapter is what is live today.

## `apply_bill_discount` lost its permission guard — found + fixed 2026-07-31

Found while verifying the ledger drift below. **`create or replace` silently reverted a security
guard**, twice, and nobody noticed because the function still existed and still worked.

The trail, all in the repo:

| migration | what it did to `apply_bill_discount` |
|---|---|
| `20260712100000_rpc_permission_checks.sql:43` | **added** `has_permission(_tenant, 'order.discount')` |
| `20260713100000_item_discounts_coupons.sql:35` | redefined the body — **guard gone** |
| `20260722120000_checkout_extras.sql:104` | redefined again — **still gone**. This is the live body |

Verified against `pg_proc.prosrc` on prod: `apply_bill_discount` has `has_tenant_role` and **no**
`has_permission`. `apply_item_discount` (created at `20260713100000:67`) **never had one**.

**Impact.** A custom role whose `order.discount` permission is revoked but whose `base_role` is
owner or manager can still discount a bill — and now an item — straight through the API. The UI hides
the control via `useHasPermission`, so the guard is in the client again. This is the same class
closed three times already (86/table-state, revenue, inventory ops), reached from a new direction:
not a missing guard, a **reverted** one.

It also makes this claim in "Team + custom roles" below **false as written**: `has_permission` is
live in `void_order_item`, `refund_payment` and `record_payment` — confirmed — but not in
`apply_bill_discount`.

**Fixed in `20260731160000_restore_permission_guards.sql`.**

- [x] `has_permission(_tenant, 'order.discount')` restored on `apply_bill_discount` and **added** to
      `apply_item_discount` (which never had one). The `has_tenant_role` floor stays — `has_permission`
      refines within a base role, it does not replace it. Same arity, so `create or replace`; grants
      re-issued anyway.
- [x] **Swept all 80 DEFINER functions + every report RPC**, comparing each `has_permission` the
      migrations *intend* against what `pg_proc.prosrc` actually holds. `apply_bill_discount` was the
      only regression. `void_order_item`, `refund_payment`, `record_payment`, `adjust_inventory`,
      `set_kot_item_status`, `set_stock_count_actual` and the rest all still carry theirs.
- [x] **The sweep found two more**, same class as the `report_sales` hole: `report_by_branch` and
      `report_top_items` were the 8th and 9th report RPCs and `20260712120000_report_fixes.sql` never
      covered them. Both read `bills`, whose RLS is tenant-scoped only, so any member could read
      revenue per branch or per dish straight through the API. Guarded the `report_sales` way — the
      predicate in the WHERE clause, so an unauthorized caller gets **zero rows rather than an
      error** and the surface degrades instead of exploding.
- [x] **Verified live**: all four hold exactly one overload (no arity trap), ACL is
      `authenticated` only with no `anon`/`public`, and with an unpermitted caller `report_by_branch`
      and `report_top_items` return **0 rows against 17 real paid bills**. `report_sales` returns its
      single aggregate row with every figure zeroed, so it leaks nothing either.
- [ ] Make it a habit: after redefining any DEFINER function, re-read `prosrc` and confirm every
      guard an earlier migration added is still in the body. A repo grep cannot find this class —
      the bug is that the repo says the guard is there twice, and the later definition wins.

## Migration ledger drift — measured 2026-07-31

This file claimed since Milestone 0 that the migration files "match remote history". **They do not.**

```
remote (supabase_migrations.schema_migrations):  93
repo   (supabase/migrations/*.sql):              92
versions present in both:                        36   <- by version number
names   present in both:                         89   <- by migration name
```

**Nothing is unapplied.** Matching on *name* instead of version, 89 of 92 line up; the three that
don't — `amend_order_add_item`, `item_discounts_coupons`, `report_sales_guard` — were each confirmed
live in the catalog anyway (`amend_order_add_item` exists; `apply_item_discount` + `apply_coupon`
exist; `report_sales` carries its `has_permission`). Remote also holds **two rows both named
`dashboard_summary`** (`20260730090521`, `20260730092707`) — the duplicate-overload incident, still
visible in the ledger.

What diverged is the **version stamp**: the Supabase MCP's `apply_migration` writes its own
server-side timestamp while the repo file carries a hand-authored one. Same migration, two numbers.
The split is clean chronologically — everything through `20260711030000` matches; everything after is
when the workflow moved to MCP.

**Why this is now dangerous rather than untidy.** `supabase db push` against the linked project would
attempt **56 migrations the ledger says never ran, against a database that already holds every one of
their objects**. The `create table` / `create policy` / `create type` ones would error; the
`create or replace function` ones would silently re-apply, including at an old arity — the exact trap
that produced the duplicate `dashboard_summary` overload. On prod, with 23 paid bills in it.

### Repaired 2026-08-13

Done through the MCP connection rather than the CLI: `migration repair` only inserts or deletes rows
in `supabase_migrations.schema_migrations`, and `supabase link` wants the database password. Same
effect, no credential handling, and **no SQL ran against the schema**. The table was copied to
`supabase_migrations.schema_migrations_backup_20260813` first.

- [x] Every ledger row classified before touching anything: **36** matched on version *and* name,
      **63** were the same migration under two stamps, **3** were repo files whose name appears
      nowhere in the ledger, **4** were MCP rows with no repo file, and `dashboard_summary` was
      recorded twice (the duplicate-overload incident; only one overload survives in the catalog).
- [x] The 3 unmatched repo files (`item_discounts_coupons`, `amend_order_add_item`,
      `report_sales_guard`) were confirmed applied by querying the catalog for the objects they
      create — `apply_item_discount`, `apply_coupon`, `bill_discount_total`, `amend_order_add_item`,
      the coupons table, `report_sales` — before being marked applied. Marking a file applied whose
      SQL never ran is the one way this repair could bless real drift.
- [x] 65 inserts, 63 deletes. **Repo files missing from the ledger: 65 → 0.** `db push` now attempts
      nothing, which was the whole danger.
- [x] Types regenerated and diffed. Only four differences, none of them schema drift: the committed
      file predated `amend_order_add_custom_item` and `merge_receipt_template`, and carried two hand
      edits (`claim_print_jobs` args typed `string[] | null` where the generator emits `string[]`).
      Regenerated clean; `tsc`, `lint` and `build` pass without the hand edits, so they were not
      load-bearing.

**The 4 MCP rows with no repo file were deliberately left in place** rather than marked reverted as
this plan originally said. Marking them reverted would delete the only record they ran while no file
exists to re-create them:

| version | name |
|---|---|
| `20260712042454` | `place_staff_order_waiter` |
| `20260720153524` | `dangerous_area_reservations_fix` |
| `20260730155626` | `set_stock_count_actual_generated_variance` |
| `20260801044543` | `printing_v2_tenant_limit_guard` |

Each one's *effect* is already carried by a repo file under another name, checked individually:
`_waiter` is in `20260720090000_place_staff_order_modifier_link_audit`; `20260720120000_dangerous_area`
already deletes reservations before tables; `20260730214500_inventory_ops` already treats `variance`
as generated (the column itself comes from `20260710095939_inventory_customers`); and the
`tenant_limit` guard is in `20260801090100_printing_bluetooth`'s `save_printer`. So the repo can
recreate the database — these four rows are historical stamps, not missing schema. Writing
reconstruction files for them would replay definitions the repo already sets elsewhere, which is how
the duplicate `dashboard_summary` overload happened in the first place.

- [ ] Optional tidy: once the CLI is linked, `supabase migration list --linked` will show those four
      as remote-only. Either leave them (harmless — `db push` skips them) or squash them into the
      repo files that already carry their effect. Do not mark them reverted without first writing a
      file.
- [ ] `brew install supabase/tap/supabase` + `supabase link --project-ref ixrcdtwdcpsmlbocvejv` is
      still worth doing so `db push` and `gen types` are available from the CLI. The ledger is
      already correct, so linking is now safe.

New migrations may go through either path from here — the ledger describes reality again. Keep using
the MCP for consistency, and always add the matching file to `supabase/migrations/` in the same
change, which is the habit whose absence created all of this.

## Printing v2 — a queue in Postgres, not a browser tab (2026-08-01)

Migrations `20260731160000_printing_v2_enums.sql`, `20260731160100_printing_v2.sql`,
`20260731170000_printing_v2_guards.sql`. Docs rewritten: `docs/printing.md`.

Prompted by a competitor comparison (RestroX), but the parity gap turned out to be the smaller half.
The v1 module (2026-07-22) got the transport right and the model wrong, and four things were broken
in ways only a real service exposes:

1. **Printing only happened in an open browser tab.** QZ Tray is driven from the page, so a QR or
   online order arriving at 02:00 with nobody at the POS printed nothing at all. `print_jobs` was a
   log written *after* the fact, not work waiting to be done.
2. **Two POS tabs meant two tickets.** Nothing claimed a job.
3. **`printers` / `print_jobs` used `apply_tenant_rls`,** which is `for all`, with the owner/manager
   check in a TypeScript server action. Any member — a waiter, an inventory clerk — could add,
   re-point or delete a printer straight through PostgREST. Same hole class as `20260727120000` and
   `20260731140000` closed elsewhere, missed here for the same reason.
4. **The browser fallback was dead code.** `dispatch.ts` called `window.open()` *after* an `await`;
   browsers block that as an unrequested popup, so a failed print produced a toast and no paper.

### Model

- [x] `printers.role` / `is_default` / `uq_printer_default` **dropped** for `printer_documents
      (printer_id, doc, copies)`. Assigning a document *is* the auto-print switch; several printers
      may carry the same one (counter + back office both print the bill); a printer with none is
      manual-only. Old rows back-filled before the drop.
- [x] `print_doc` enum: `kot · bot · full_kot · order_slip · bill · test`. `kitchen_stations.kind =
      kitchen|bar` is what makes a ticket a BOT. Station routing still wins for kot/bot; the document
      assignment is the fallback for unrouted stations.
- [x] `print_jobs` became a queue: `doc`, `order_id`, `branch_id`, `copies`, `claimed_at`,
      `claimed_by`, `idempotency_key`, plus `claimed`/`cancelled` states.

### Queue

- [x] Enqueue triggers — `enqueue_kot_print` (after insert on `kots`) and `enqueue_bill_print`
      (bill → paid). Auto-print now works on every path at once: POS, QR, online storefront, Flutter,
      offline replay. No client knows printing exists.
- [x] Rows carry a reference and **no payload**; the claimer asks the server to render. One rendering
      source of truth, and a ticket amended between queueing and printing comes out amended.
- [x] `claim_print_jobs` uses `select … for update skip locked` + a 60s stale-claim requeue. That is
      the entire anti-duplicate mechanism.
- [x] `unique(tenant_id, idempotency_key)` on `<doc>:<ref>:<printer>`; reprints pass `null`.
- [x] `print_jobs` added to the realtime publication + `replica identity full`.

### Transports

- [x] **Local** — `components/print/auto-print-worker.tsx`, mounted once in the app shell. Drains via
      realtime + a 20s safety poll. Network, USB and system printers.
- [x] **Cloud** — `tools/print-agent/agent.mjs`. Signs in as an ordinary staff user (no service role,
      no shared secret), claims, renders through `/api/print/render` with a bearer token, writes to a
      `net.Socket`. Answers PRD §9. **Boundary: network printers, text mode.** USB/system need QZ in a
      browser; it fails those jobs with a sentence saying so rather than printing garbage.
- [x] USB addressing: `qz.usb.listInterfaces` → `listEndpoints` (skip endpoints with bit 7 set —
      those are IN) → `claimDevice` → `sendData` → `releaseDevice` in a `finally`; path cached via
      `set_printer_usb_path`.

### Rendering

- [x] `lib/print/docs.ts` is a document model; `escpos-render.ts` and the client canvas rasteriser
      both consume it, so the two renderers cannot drift. `job-render.ts` takes a Supabase client, so
      the server action and the API route share one path.
- [x] **Image mode** (`printers.render_mode`) for Devanagari and every other non-Latin script. Two
      API facts forced the design: QZ's `{type:'pixel', format:'html'}` goes through an **OS printer
      driver** and cannot reach a network printer on a socket (which is how most kitchen printers are
      wired), and `qz.usb.sendData` takes bytes only — QZ's `format:'image'` converter is not on that
      path. So the browser draws to a canvas and we encode `GS v 0` bit-image bands (128 rows) by hand.
- [x] 76mm impact paper. `columnsFor(76) = 40`, not the 42 the arithmetic gives — the carriage cannot
      reach the last two columns.
- [x] Per-printer `auto_cut` and `open_drawer`, per-document `copies`.

### Security

- [x] Select-only RLS on `printers`, `printer_documents`, `print_jobs`. Every write via
      `settings.edit`-gated SECURITY DEFINER RPCs: `save_printer`, `delete_printer`,
      `set_station_printer`, `set_station_kind`, `set_printing_mode`, `enqueue_print_job`,
      `claim_print_jobs`, `complete_print_job`, `retry_print_job`. Full signatures named on every
      `revoke`/`grant`.
- [x] `printers.branch_id` is finally written and filtered — it existed since v1 but was never used,
      so a two-branch tenant printed Branch B's tickets in Branch A.
- [x] New `tenant_limit(_tenant, _key)` + `plans.limits.printers` (2 / 10 / 100). **Shipped without a
      membership check and fixed the same day** — SECURITY DEFINER meant any signed-in user could ask
      what plan any other restaurant was on by passing its id. Caught by a guard sweep over `prosrc`,
      not by reading the repo.
- [x] **`/api/qz/cert` un-gated (2026-08-14).** It required a session, so every auth hiccup answered
      401, qz-tray turned the failed fetch into an *empty* certificate, and QZ Tray asked the operator
      to allow each ticket as "an anonymous request" — no error anywhere, just prompts returning.
      Proved from `~/Library/Application Support/qz/debug.log`: `{"certificate":""}` on the failing
      connects, full PEM on the working ones. The cert is public (it ships as `override.crt` on every
      operator's machine), so gating it protected nothing. `/api/qz/sign` stays gated — that is the
      private half. Both promises now `console.warn` on failure, because a silent downgrade to
      unsigned is the whole bug.

### UI

- [x] `printers-tab.tsx` rebuilt: three stat cards (count/limit · direct-printing status · Local/Cloud
      mode), search, Test all printers + a results dialog, auto-print columns per document (icon **and**
      a screen-reader word — a tick alone is unreadable in greyscale), and a **print queue** section
      where anything waiting or failed stays with a Try again button instead of vanishing with a toast.
- [x] `printer-sheet.tsx` rebuilt: Network / USB / System chips, USB and system scan, vendor + product
      ID, render mode, branch, cut, drawer, and the document-assignment cards with copies steppers.
- [x] Setup dialog with **Download override.crt** (`/api/qz/cert?download=1`) and the per-OS folder.
- [x] Station type select on Menu → Stations.
- [x] POS "Print order slip" now prints an actual order slip — itemised, with prices, for the guest.
      It re-printed the kitchen tickets before, which is a different piece of paper for a different
      person.
- [x] Fire no longer prints from the client at all; `create-flow` / `amend-flow` just place and fire.

### Review pass (same day, before commit)

Six defects found by re-reading the risky paths rather than trusting the first write. Worth recording
because five of them would only ever have shown up on paper, in service.

- [x] **A retry stamped `*** REPRINT ***` on paper the kitchen had never seen.** The banner was keyed
      on `attempts > 0`, but a job that failed because the printer was out of paper has attempts and
      has printed nothing — telling a cook the food is already on. Now keyed on whether *any* job for
      the same document ever reached `printed`.
- [x] **Manual reprints ignored branch scoping.** The enqueue trigger filtered printers by branch;
      the TypeScript path did not, so a manual bill reprint queued on every branch's bill printer.
- [x] **A manual reprint of a bar ticket printed a KOT header.** `printKot` always passed `doc: 'kot'`;
      the station's `kind` now decides, as it does on the trigger path.
- [x] **Manual reprints ignored per-document copies** — a printer set to two copies of every bill
      produced one. `_copies` was passed as null.
- [x] **The image-mode test page drew an 80mm ruler on every printer.** `columnsFor(80)` was
      hardcoded, so on a 58mm roll the one element whose entire job is to prove the width was itself
      the wrong width.
- [x] **`printableDots(76)` was 420, not a multiple of 8.** A raster row is sent as whole bytes, so
      the printer drew a 424-dot row against a 420-dot canvas. Now 416.

- [x] **`tenant_limit` shipped as SECURITY DEFINER with no membership check** — any signed-in user
      could read another restaurant's plan ceiling by passing its id. Caught by sweeping `prosrc` for
      guards, not by reading the migration. Fixed same day.
- [x] **Platform-admin inconsistency** (`20260731170000_printing_v2_guards.sql`). `save_printer` and
      the station setters gate on `has_permission`, which carries an `is_platform_admin()` escape, as
      does every policy in the schema. The queue functions gated on bare `current_tenant_ids()`, so an
      admin impersonating a restaurant could configure its printers but got 42501 on Test print —
      exactly what they are impersonating in order to diagnose.
- [x] Isolation re-verified after the escape, as a real non-admin member with a simulated JWT:
      cross-tenant `save_printer` / `enqueue_print_job` / `claim_print_jobs` all refused with 42501,
      cross-tenant `tenant_limit` returns null, and `printers` shows only their own row. Happy path
      also verified end to end under the same JWT: create → edit (network → USB) → delete, name
      trimmed, `test` refused as an assignable document, copies preserved.

**Deliberately left alone.** A bill refunded and then re-settled does not print a second receipt —
the idempotency key already exists. Silent dedup beats surprise paper. The browser worker claims for
every role, so an inventory clerk's screen will help drain the queue and see "Printed" toasts; it
exposes nothing RLS did not already allow, and any open till keeping the printers fed is the point.

### Verification

- [x] ~600 byte-level assertions across 58/76/80mm × 6 documents: line width **at the magnification in
      force**, cut last, `ESC @` first, TOTAL flush to the paper edge, drawer and cut only when
      configured, Devanagari → `?` with no control bytes. A naive scanner counts `ESC a 0`'s argument
      as the letter "a" — the first version of the harness "failed" 97 assertions for that reason.
- [x] DB suite in rolled-back transactions: trigger enqueue counts, copies, full-KOT-once-per-order,
      bill fires once on settle and not twice, `save_printer` refuses an unauthenticated caller
      (42501), delete unroutes stations and cascades documents, RLS is SELECT-only on all three tables.
- [x] `tsc`, `lint`, `npm run build` clean. Migrations applied to prod with 0 printers and 0 jobs
      existing, so the model change carried no data risk.
- [ ] End-to-end on real hardware: network printer, USB printer, image mode with a Devanagari dish
      name, two tabs open, and the agent running with every browser closed. Needs a physical printer.

### QZ Tray has no raw USB on Apple Silicon (2026-08-13)

First run against the shop's KP307 over USB. Every job failed with QZ's *"Sorry, this feature is
unavailable at this time"*. `~/Library/Application Support/qz/debug.log` names it:
`java.lang.UnsatisfiedLinkError: 'int org.usb4java.LibUsb.init(org.usb4java.Context)'` on
`usb.listInterfaces`. QZ Tray 2.2.6's macOS bundle ships `libhidapi`/`libjssc` but **no
libusb4java native** — the whole `qz.usb.*` API is dead on an arm64 Mac. Not our bug, and not
fixable from our side.

The route that works is the OS queue: the printer already installs as a CUPS destination
(`usb://Caysn/KPC307-UEWB`), and a raw ESC/POS job through it prints — verified with
`lp -d POS80-2 -o raw`. So on macOS, **USB printers must be configured as `system`**, not `usb`.

- [x] The shop's `KT` printer switched from `usb` → `system` (`POS80-2`).
- [x] `qz.usb.*` failures now say to switch to a system printer instead of repeating QZ's sentence.
- [ ] Consider hiding the USB connection option (or marking it unsupported) when the agent is on
      macOS — the setup sheet currently offers a route that cannot work there.

### macOS Local Network permission blocks every LAN printer (2026-08-13)

The cause of both `java.net.NoRouteToHostException` (QZ Tray) and `connect EHOSTUNREACH`
(cloud agent) against `192.168.254.14:9100`, while `ping` and `nc` from a terminal succeeded.
macOS 15+ gates LAN connections per app; a denied process is refused **in ~1ms**, before a packet
leaves — which is what distinguishes it from a real network fault. Grant in Privacy & Security →
Local Network, then restart the process.

The entries are not named what you expect. QZ Tray appears as **java**: installing `override.crt`
into `Contents/Resources/` breaks the bundle's code signature, so macOS cannot resolve
`io.qz.qz-tray` and attributes the socket to the embedded JRE (`net.java.openjdk.java`) — visible in
`log show --predicate 'eventMessage CONTAINS "LocalNetwork"'`. The cloud agent appears as **node**.

- [x] Both granted; network printing verified from a browser and from launchd.

### Cloud mode was dead on the deployed app (2026-08-13)

`proxy.ts` redirected every unauthenticated request to `/login`, route handlers included. The agent
carries a bearer token and no cookie, so `POST /api/print/render` returned `307 → /login` and it
could never reach the handler that understands its token. Fixed in `lib/supabase/proxy.ts` (commit
`4ce43c4` on main): `/api/*` is excluded from the redirect and each route answers for itself — all
four were audited and already guard their own callers.

- [x] Cloud mode live end to end: `print_jobs` row → agent claims → socket → paper, no browser open.
      Agent user `print-agent@extrahelper.local` (role `kitchen`), config in gitignored
      `tools/print-agent/config.json`, kept alive by
      `~/Library/LaunchAgents/com.extrahelper.print-agent.plist`.
- [ ] The agent runs on the shop Mac, because only a machine on the shop LAN can reach the printer.
      A sleeping Mac is still a silent kitchen — decide what always-on box hosts it.
- [ ] Cloud mode is text-only and the KP307 is CP437, so a Devanagari dish name prints as `?`.
      Image mode needs a browser canvas. If Nepali menu text is wanted on tickets, either keep that
      printer on Local mode or teach the agent to rasterise.

### The certificate download handed out an empty file (2026-08-13)

`QZ_PUBLIC_CERT`/`QZ_PRIVATE_KEY` were never set, so requests went out unsigned
(`"signature":""` in the QZ log) and QZ prompted on every ticket. Two things hid it: the
`?download=1` route served a **0-byte `override.crt`** rather than admitting it was unconfigured,
and the setup dialog gave the macOS folder as `/Applications/qz-tray` when QZ reads
`/Applications/QZ Tray.app/Contents/Resources` — so the empty file landed somewhere QZ never looks.
Both fixed; key pair generated into the gitignored `.qz/` and wired into `.env.local`.

- [ ] Set `QZ_PUBLIC_CERT` / `QZ_PRIVATE_KEY` in the deployed environment too — they are local-only
      so far, so the hosted app still prompts.

## Printing from the phone — a third drainer (2026-08-01)

Migrations `20260801090000_printing_bluetooth_enum.sql`, `20260801090100_printing_bluetooth.sql`.
Mobile half lives in `../extrahelper_flutter/lib/data/print/` — its own entry in that TASKS.md.

**Why.** The shop's printer (an 80mm POSiFLOW KP307: USB + LAN + WiFi + BT) does not do browser
print, and never will: JavaScript has no raw socket, and `window.print()` goes through a driver and a
page dialog. Something native has to drive it. QZ Tray and the headless agent already did — and so,
it turns out, can the Flutter app, which needs nothing installed on any computer. `dart:io` opens a
socket to port 9100 on both platforms, and Android speaks Bluetooth SPP.

- [x] `printers.bt_address` + `'bluetooth'` on `printer_connection`, with `printers_target_present`
      extended. Split across two migrations: Postgres refuses to *use* a new enum value in the
      transaction that adds it.
- [x] `save_printer` grew `_bt_address`; **drop + create**, not `create or replace`, with
      `revoke`/`grant` re-issued naming the full 17-argument signature.
- [x] `claim_print_jobs` grew `_connections text[]` and `_render_modes text[]` (null = anything), so
      a claimer only takes work it can finish. Same drop + create + regrant. Verified afterwards:
      one signature each, `public` and `anon` hold no EXECUTE.
- [x] Who claims what: the browser passes `network|usb|system` and **every** render mode, so an open
      till stays the catch-all; the Node agent passes `network` + `text`, which it could already
      only drive; the phone passes what its transports report plus `text`. A Bluetooth ticket is
      therefore never claimed by a browser that would have to fail it.
- [x] Bluetooth chip + address field in `printer-sheet.tsx`, with a note that neither printing mode
      governs it — it is the phone or nothing. `print-provider.tsx` throws a sentence rather than
      quietly asking QZ for a system printer of that name.
- [x] `PRINTER_COLS`, `PrinterRef`, `printerTarget()`, settings page projection and
      `database.types.ts` all carry `bt_address`.
- [x] `tsc`, `lint` (no new problems — the 7 that remain predate this and are in files nobody
      touched here), `npm run build` clean. Migrations applied to prod; additive, so no data risk.
- [ ] End-to-end on the KP307: WiFi from an Android phone and an iPhone, Bluetooth from Android,
      four drainers at once printing exactly one slip, printer switched off → readable error →
      retry. Needs the physical printer.

- [x] **Caught on re-read: the filter orphaned deleted-printer jobs.** `print_jobs.printer_id` is
      `on delete set null`, so deleting a printer with something queued leaves a job that matches no
      capability — under the new filter, unclaimable by anything, waiting forever and invisible.
      Before, a drainer claimed it and failed it with "no printer", which at least someone could see.
      A null `printer_id` is now claimable by anyone
      (`20260801090200`, `create or replace`, same arity, grants verified intact).

**Known gap, deliberate.** If *every* drainer filters, a job nothing can drive waits on the queue
rather than failing loudly. That is why the browser keeps claiming every render mode. The
troubleshooting table in `docs/printing.md` names the symptom.

The mobile half had seven more defects found the same way — two of which made Bluetooth impossible
and one of which could kill printing on a device until it was restarted. They are written up in
`../extrahelper_flutter/TASKS.md` under Milestone M.

## Milestone 0 — Foundation
- [x] Create Supabase project; wire env/secrets (service role server-only) — project `ixrcdtwdcpsmlbocvejv` live, `.env.local` wired (publishable key only client-side; RLS is the gate). **Owner decision 2026-07-31: this project IS prod.** No separate prod project, no staging — the app is already deployed at `https://extra-helper.vercel.app/` against it. Staging comes after launch, once the feature backlog settles. What this costs is written down under "Single-environment decision" below so nobody rediscovers it.
- [~] Install/verify toolchain: Node LTS, Supabase CLI, Docker, Flutter SDK, Xcode, Android Studio — **mobile toolchain done (2026-07-26)**: Flutter 3.38.7 / Dart 3.10.7, Xcode 26.2 + **CocoaPods 1.17.0** (Docker dropped by owner decision 2026-07-31 — see the CLI line below), Android SDK 36.1.0 + **cmdline-tools 21.0** with licenses accepted (`ANDROID_HOME` in `~/.zshrc`); `flutter doctor` reports **no issues**. TODO: Supabase CLI + Docker (migrations still applied via Supabase MCP instead).
- [~] Set up Supabase CLI + migration workflow + seed script — migration files in `supabase/migrations/` (92), `supabase/seed.sql` (idempotent demo data), `supabase/tests/rls_isolation_test.sql`. **Docker/local stack dropped (owner, 2026-07-31)** — both ends are hosted (Supabase + Vercel), so a local Postgres buys nothing. CLI itself is still wanted and is Docker-free (`link`, `migration list`, `migration repair`, `db dump`, `gen types`; only `db diff` and `start` need Docker). **Blocked on the ledger repair below — see "Migration ledger drift".**
- [x] Design core schema (tenancy → users → tables/menu/orders/bills/inventory) as SQL migrations — 45 tables across 9 domains in `supabase/migrations/` (foundation, operations_menu, orders_billing, inventory_customers); applied via Supabase MCP. TS types in `lib/supabase/database.types.ts`.
- [x] Add `tenant_id` (+ `branch_id`) to every business table — denormalized onto child tables too, so RLS keys on one column everywhere.
- [x] Baseline **RLS policies** on every table — resolved via `user_tenants` membership (not JWT claim; a user may hold different roles per tenant). Helpers `current_tenant_ids()` / `has_tenant_role()` / `is_platform_admin()` (SECURITY DEFINER). `apply_tenant_rls()` applies the standard tenant-isolation policy. 0 public tables without RLS.
- [x] Auth: email/OTP/social; JWT custom claims (`tenant_id`, `role`) — email+password login/signup/logout wired (Supabase SSR, `proxy.ts` session refresh + route guard). **Verified E2E** (signup→confirm→login→dashboard, session in `auth.sessions`) via browser + Supabase MCP. Tenant/role now resolved via `user_tenants` (membership-table RLS), so JWT custom claims are optional/deferred. TODO: OTP/social; optional access-token hook for claim-based perf. ✅ Finished in partial-features sprint (2026-07-13).
- [x] RBAC role model + guards — `app_role` enum + `user_tenants` membership + `platform_admins`; RLS via `has_tenant_role()`; app-level guards in `lib/supabase/guards.ts` (`requireUser`/`requireTenant`/`requireRole`/`requirePlatformAdmin`). TODO (per feature milestone): fine-grained per-action write gating (only managers void/discount).
- [x] `audit_logs` table + write helper — append-only RLS + `writeAudit()` (`lib/supabase/audit.ts`, actor = auth.uid()); used by super-admin suspend/activate. Wire into voids/discounts/refunds/price changes as those features land.
- [x] Next.js app shell (App Router) — auth + routing + protected dashboard; server tenant context `getActiveTenant()` + client `TenantProvider`/`useTenant` (`components/tenant-provider.tsx`); dashboard redirects to `/onboarding` when no tenant. Tenant switcher shipped (sidebar picker + "+ Add restaurant").
- [x] User profiles — `profiles` table + `avatars` bucket + `handle_new_user` trigger (default @handle, backfilled); signup captures full name; `/profile` page (name/@handle/avatar upload); sidebar/nav-user show real name+initials. RLS scoped to self + co-members + platform admin (verified). (2026-07-13)
- [x] Get-Started onboarding choice + multi-restaurant + self-serve join — `/onboarding` stepper (profile card + Create/Join); `provision_tenant(_force_new)` lets one user own many restaurants (verified 1→2); `tenant_join_codes` + `create_join_code`/`redeem_join_code` (redeem→pending, owner approves) + team-page code generator; `claim_invites` now also runs on OAuth/magic-link callback. (2026-07-13)
- [~] Flutter app shell (iOS + Android) — Supabase SDK, auth, navigation, tenant context. **Unblocked and scaffolded (2026-07-26)** in its own repo `../extrahelper_flutter/` (github `D-Raj-Grg/ExtraHelper_App`, own planning docs mirroring this set). Milestone A done: project scaffold (bundle id `com.extrahelper.app`), `supabase_flutter` wired via `--dart-define-from-file`, layered `lib/` skeleton, strict lints, and it **builds + launches on both an iOS simulator and an Android emulator** with the Supabase client initialised. Stack: Riverpod 2 (riverpod 3 needs Dart ^3.11 — it pulls `package:test`, which forces `web_socket_channel <3` against `realtime_client`'s `^3`), Drift, go_router. TODO: auth + tenant context + permission gate (its Milestone C), then waiter ordering + offline queue.
- [x] Tenant onboarding wizard (profile, currency, tax, branches, branding) — `/onboarding` page + `provisionTenant` action + `provision_tenant()` SECURITY DEFINER fn (atomic tenant + settings + default branch + owner membership; idempotent). **Verified E2E** via MCP as authenticated user: 1 tenant/membership/branch/settings, no dupes on repeat call. TODO: tax rules step, branding/logo upload, multi-branch, browser UI E2E (extension was disconnected). ✅ Finished in partial-features sprint (2026-07-13).
- [x] Super-admin console skeleton (tenant list, activate/suspend) — `/admin` page (`requirePlatformAdmin` guard + RLS), lists all tenants, suspend/activate action (`app/admin/actions.ts`) audited. Needs a `platform_admins` seed to view (blocked from self-seeding by safety classifier — owner must grant).
- [x] Per-tenant settings model (currency, tax rules, service charge, receipt template, fees) — `tenant_settings` table (region-configurable, rule #2) + `/settings` UI (owner/manager) editing currency/timezone/service charge/packaging fee; onboarding writes currency + timezone. TODO: tax rules + receipt template editors (jsonb columns exist).
- [x] Integration adapter interfaces stubbed: payments, printing, notifications — `lib/integrations/` pluggable interfaces + per-tenant resolvers + dev stubs (manual gateway, no-op print, console notify), rule #6. Concrete providers register at runtime.
- [x] **Verify:** RLS isolation test — tenant A cannot read/write tenant B. Automated `supabase/tests/rls_isolation_test.sql` (non-member: read blocked, insert → `insufficient_privilege`, `has_tenant_role` false) — **passes**. All tables share one `apply_tenant_rls()` policy, so one test covers the pattern.

## Milestone 1 — Core Operations (P0)
- [x] Menu management: categories, items, variants, modifiers, combos, images, 86 toggle, availability schedules — `/menu` page + `app/menu/actions.ts` (owner/manager guarded): category CRUD, item create/delete/86-toggle, price in cents. **Verified** RLS write path + nested station query via MCP. TODO: variants, modifiers, combos, image upload (Storage), availability schedules, inline price/name edit. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Kitchen stations + per-item station routing config — station create + single-station routing on item create (`item_station_routes`), shown per item on `/menu`. TODO: multi-station routing editor, edit/remove routes. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Floor/table management: floors/areas, visual floor map, capacity, table states — `/tables` page + `app/tables/actions.ts`: floor + table CRUD, capacity, live state control (free/occupied/reserved/bill_requested/cleaning). **Verified** state write under RLS (waiter-level). TODO: drag-and-drop visual floor map (pos_x/pos_y columns exist), merge/split/transfer. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Table QR code generation (stable token per table) — every table has a stable `qr_token`; `/tables` "QR" button renders a **scannable QR image** (`components/table-qr.tsx`, `qrcode` lib → self-contained PNG data-URI, CSP-safe) encoding `/t/{token}`, with Print / Download / Copy link. Customer page `/t/[token]` built (Milestone 5). **Verified E2E**: T1 QR renders + encodes the dine-in URL.
- [x] Waiter ordering — **web POS** built (`/pos` + `/pos/[orderId]`, `app/pos/actions.ts`): start order (table/takeaway), add menu items (86 blocked), remove, running total, fire. TODO: Flutter waiter app, modifiers/variants, notes, course/seat, hold-vs-fire granularity. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Order lifecycle state machine (`draft→placed→in_kitchen→preparing→ready→served→billed→closed`) — draft→in_kitchen via `fire_order`; KDS bump advances kitchen states. TODO: served→billed→closed (billing milestone), guarded transitions. ✅ Finished in partial-features sprint (2026-07-13).
- [x] KOT generation on fire — split per station, each its own ticket — `fire_order()` SECURITY DEFINER fn (authorizes caller, routes items via `item_station_routes`, no-route → expo ticket, idempotent). **Verified E2E**: Grill (burger+fries) + Bar (cola) split correctly.
- [x] KOT amendments (added/void items, reason + approval for voids) — void via `void_order_item()` (manager approval + reason + audit), recompute on bill. Added-items: re-add + re-fire (fire_order idempotent, tickets only un-ticketed items). TODO: explicit KOT amendment tickets / void propagation to KDS. ✅ Finished in partial-features sprint (2026-07-13).
- [x] KDS full-screen web view per station: ticket aging colors, item/ticket bump, all-day counts, recall — `/kds` board with aging borders (green/amber/red), per-ticket bump (new→preparing→ready→served), fullscreen, realtime auto-refresh. **Per-station filter**: pill row (All / each station / Expo) → `?station=`, scoped server query + client refetch + realtime, persisted in `localStorage` so a screen reboots into its station. **All-day counts** strip (qty per item across visible tickets). **Recall**: recently-served (≤20m) shown as recall chips → `recallKot` sets served→preparing so an early-bumped ticket returns. Bump E2E verified.
- [x] 86 item from KDS → disables item on all ordering surfaces (realtime) — 86 toggle on `/menu`; POS blocks 86'd items. TODO: 86 from KDS + realtime propagation. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Thermal KOT print — **browser-print transport** (thermal printer prints via its OS driver; no external agent/cloud dependency). `app/kot/[kotId]/page.tsx` renders an 80mm ticket (station, table/type, items, modifiers, seat, notes, item count) + `@page 80mm`; `components/kot-print.tsx` auto-fires `window.print()` on load and stamps `kots.printed_at` via `markKotPrinted`. **Print button** on every KDS ticket (reprint). **Print-on-fire**: `fireOrder` re-queries the new KOT ids → POS opens a print view per station ticket. ESC/POS local-agent + cloud-print adapter slot preserved in `lib/integrations/printing.ts` for later. **Superseded by the printing module (2026-07-22)**: silent ESC/POS printing via a local agent (QZ Tray), a `printers` registry with station→printer routing, paper width 58/80mm, a print-job log with reprint, and Settings → Printers. Browser print is now the automatic fallback, not the only path. **Superseded again by printing v2 (2026-08-01)**: a Postgres job queue with `for update skip locked` claims (no duplicate tickets across tabs, no browser needed at all in Cloud mode), `printer_documents` auto-print assignment replacing the `role` enum, KOT/BOT/Full KOT/Order slip/Bill documents, USB vendor/product addressing, 76mm, per-printer cut/drawer/copies, image mode for Devanagari, branch scoping, plan limits, and `settings.edit`-gated RPCs replacing the tenant-only RLS. See `docs/printing.md`.
- [x] Realtime sync: table states + KOT + order status across waiter/KDS/cashier — **live via Supabase Realtime** (`postgres_changes`, tenant-filtered) on `/tables`, `/pos`, `/kds`, no manual refresh. **Root fix**: the browser Realtime socket must carry the user JWT (`realtime.setAuth`) or RLS drops all events — added `components/realtime-auth.tsx` (setAuth on mount + token-refresh) + singleton browser client (one shared socket). Surfaces hold client state (tables merge changed row in place; KDS/POS debounced scoped refetch) instead of full-page `router.refresh`. Retired `realtime-refresh.tsx`. Verified 2-tab live. (branch → future.)
- [~] **Verify:** order → KOT fires → KDS + print → bump → served — **browser E2E passed**: POS start→add Burger+Cola (US$15)→fire→2 KDS tickets (Grill/Bar)→bump Grill to Preparing; `/tables` + `/menu` render. Fixed 3 bugs found here: PostgREST embed ambiguity (orders↔restaurant_tables 2 FKs → `!orders_table_id_fkey` hint), `"use server"` const-array exports breaking client import (KOT_FLOW/TABLE_STATES → moved to plain modules), `fire_order` anon-executable. TODO: thermal print, served→billed.

## Milestone 2 — Billing / POS
- [x] Running bill per table/order (multi-order per bill) — `create_bill_for_order()` snapshots order lines → `bill_items`, `/bill/[billId]` view. TODO: multiple orders on one bill (currently one order = one bill). ✅ Finished in partial-features sprint (2026-07-13).
- [x] Line pricing pulls price + tax class from menu — `order_items` snapshot `unit_price_cents` at add time; bill lines from those. (tax_class column exists for per-line tax later.)
- [x] Configurable tax (multiple rates, inclusive/exclusive), service charge %, packaging charge — **computed in trusted SQL** (`create_bill_for_order`, SECURITY DEFINER), read from `tenant_settings` (rule #2). **Verified**: $17 + 10% service + 13% VAT → $18.70/$21.x correct; exclusive taxes add, inclusive skipped; packaging on pickup/delivery only.
- [x] Discounts: %/flat, item + bill level, coupon codes, manager approval — bill-level via `apply_bill_discount()` + **item-level `apply_item_discount()`** (owner/manager gated + audited) + **coupon codes** `apply_coupon()` (cashier-usable, validated: active/expiry/max-uses/no-double-apply) — migration `20260713100000`. Unified `bill_discount_total(_bill_id, _subtotal)` computes bill-level (vs subtotal) + item-level (vs its non-void line, flat capped at line) discounts; both `apply_bill_discount` and `recompute_bill` now use it, so item/coupon discounts **survive a recompute** (void / further discount) instead of being ignored. New `coupons` table (per-tenant code, type, value, active, expiry, max_uses, used_count) with RLS. `/bill` UI: per-line **disc** button (manager) + **coupon** input (any cashier). TODO: coupon-management admin UI, finer cashier discount threshold.
- [x] Split bills: equal / by item / arbitrary amounts — **schema-free** (`components/bill-split.tsx`): compute each payer's share client-side, record it as its own `payments` row against the one bill; `record_payment` rolls open→partial→paid and closes the order on the final share. **Equal**: N-way exact distribution (remainder spread). **By item**: checkbox lines → proportional share of the whole bill (tax/service/discount incl.), capped at due + a **Pay remaining {due}** button so the last payer settles rounding exactly. **Arbitrary**: the existing editable Amount field. **Overpay-hardened** (adversarial review): `record_payment` now clamps the applied amount to the outstanding balance — `least(amount, total − paid_before)` — so no path can overpay (migration `20260712140000`); split uses **deterministic per-share idempotency keys** + a sync in-flight guard so a double-click de-dups instead of double-charging. `payment.take` gated. Survives `recompute_bill` (no split state persisted on bill_items). TODO: by-seat (needs POS `order_items.seat` entry first).
- [x] Partial payments (pay now, remainder later) — `record_payment()` tracks paid vs total → open/partial/paid. **Verified** partial→full. TODO: UI already supports custom amount; test partial in browser. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Payment methods: cash, card (manual), split across methods; record + status — cash/card via `/bill` UI, `payments` rows with idempotency keys, status transitions. **Verified** browser (cash full → paid → order closed → table freed). TODO: online/wallet/points methods, split-across-methods UI. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Void/refund with reason + role approval + audit trail — `void_order_item()` (manager-gated, reason required, trusted `recompute_bill` on unpaid bills, audited) + `refund_payment()` (manager-gated, over-refund guarded, bill→void/partial, audited). `/bill` UI: per-line void + refund block, manager-only. **Verified E2E**: void Fries → recompute $18.70→$13.20; refund partial+full via MCP; audit rows logged. (migration `20260710191900_void_refund`)
- [x] Receipt template (logo, tax breakup, footer/terms) → thermal print + digital (email/SMS/QR link) — `/receipt/[billId]` printable thermal-style receipt (items, subtotal/service/tax/discount breakup, total, payments, footer/terms from `tenant_settings.receipt_template`) + `window.print()`. Digital via notification adapter (`emailReceipt` → `lib/integrations` console stub, rule #6). **Verified E2E**: receipt renders, print, email fired (server log `[notify:email]`). TODO: logo upload, per-rate tax breakup, public QR-link receipt (anon, Milestone 5).
- [x] Cash session open/close, expected vs counted reconciliation, shift report — `open_cash_session()` + `close_cash_session()` (SECURITY DEFINER, cashier/manager/owner). Expected = float + cash payments since open; variance = counted − expected. `/cash` UI: open drawer, close & reconcile, shift-report table. **Verified E2E**: open $50 → close $50 → variance $0; MCP-verified expected=float+sales. (migration `20260710192744_cash_sessions`)
- [~] **Verify:** bill → split payment → receipt; day-close reconciles — **browser E2E passed**: order→fire→generate bill (trusted tax/service)→pay cash→paid/closed/table-freed. Fixed 2 bugs found here: Base UI Button a11y (`nativeButton={false}` on link-buttons), currency hydration mismatch (`Intl.NumberFormat(undefined)` → shared `lib/format.ts` with pinned locale). **Day-close verified** (cash session reconcile). TODO: split bills, receipt.

## Milestone 3 — Inventory
- [x] Inventory items: UoM, category, reorder level, par level, cost — `inventory_items` + `/inventory` UI (name, uom, on-hand, reorder, cost, add). TODO: category, par level fields in UI. ✅ Finished in partial-features sprint (2026-07-13). **Barcode added 2026-07-30** (unique per tenant where set) for the mobile scanner — see "Inventory ops moved into Postgres" above. **Mobile store room done**: on-hand + low stock, stock count through a shared RPC (offline-capable), adjust/waste online-only, in `../extrahelper_flutter/TASKS.md` Milestone J.
- [x] Recipe/BOM mapping: menu item → ingredient quantities — `/inventory` recipe form (dish → ingredient × qty) + list; `addRecipe` action. **Verified**: "Classic Burger uses 1 unit of Burger Bun".
- [x] Auto-deduct stock on sale (trusted trigger/function) — `trg_deduct_stock` trigger on `order_items` (fires on transition → in_kitchen), deducts recipe qty × ordered qty from `inventory_items`, logs `stock_movements` (type='sale'). SECURITY DEFINER, idempotent (once per transition). **Verified E2E**: browser sell burger → Bun 15→14; MCP 100→98, re-fire no double-deduct. (migration `20260710194337_inventory_deduct`)
- [x] Stock movements: sale, wastage, staff meal, transfer — `stock_movements` logged on sale (auto) + manual purchase/wastage/adjustment via `/inventory` adjust. TODO: staff meal, transfer types in UI. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Suppliers + purchase orders + receive (GRN, partial/full) + price history — `/purchasing`: supplier CRUD, create PO, add lines, **Receive (GRN)** via `receive_po()` (trusted: +stock, `purchase` movement, updates last cost, PO→received). **Verified E2E**: PO 30 buns → receive → Bun 14→44, cost→$0.20, alert cleared. TODO: partial receive, price history view. (migration `20260710200525_receive_po`) ✅ Finished in partial-features sprint (2026-07-13).
- [x] Stock counts/audits → variance (theoretical vs actual) → wastage/shrinkage — full lifecycle wired (migration `20260713110000`): `start_stock_count(_tenant)` snapshots on-hand as theoretical; staff enter actuals (`stock_count_items` via RLS); `post_stock_count()` reconciles on-hand to actual per changed line + logs a `count` stock movement per delta (once — `posted_at` guard). UI: `/inventory` "Start stock count" + recent-counts list → `/inventory/count/[id]` sheet (`components/stock-count-sheet.tsx`) with live variance colouring, post & reconcile. Gated owner/manager/inventory.
- [x] Low-stock / reorder / out-of-stock alerts + suggested reorder qty — `/inventory` flags items where on-hand ≤ reorder (row badge + banner count). **Verified E2E**: waste 85 → Bun 15 → "low stock". TODO: suggested reorder qty (par − on-hand), notifications.
- [ ] Barcode/QR scanner support (stock-in + counts)
- [ ] Multi-branch stock (per branch)
- [ ] Valuation (FIFO/avg cost) + consumption views by time window
- [x] **Verify:** sell dish → stock deducts per recipe → alert → PO → GRN restocks (E2E) — **full loop verified in browser**: sell burger (Bun 15→14) → low-stock alert → create PO (30 buns @ $0.20) → Receive GRN → Bun 44, cost updated, alert cleared. + MCP edge coverage.

## Milestone 4 — Reporting & Analytics
- [x] Reporting aggregation layer (server-side) with windows + custom range + prev-period compare — **server-side SQL** report fns (SECURITY INVOKER, RLS-scoped; `report_staff` DEFINER). `/reports` window selector (today/7/30/365/all) + **custom from/to date range** + prev-period delta, tenant-tz. TODO (minor): calendar-aligned windows (currently rolling). (migrations `20260710201536`, `20260710201633`, `20260712030000`, `20260712110000`)
- [x] Sales reports: by item, category, hour, table, waiter, payment method, order type — `/reports` Sales tab: **by item, category, order-type, hour, table, branch, payment method** (waiter under Staff tab). tz-aware. (`report_sales_by_bill`/`report_sales_by_category`, `20260712110000`)
- [x] Billing dashboard: revenue, tax, discounts, voids, refunds, avg ticket, turnover — all tiles on `/reports` Sales tab incl. **voids, refunds, table turnover** (`report_extras`).
- [x] Inventory reports: consumption, COGS, wastage, valuation, reorder needs — `/reports` Inventory tab (`report_inventory`): per-item consumed/wasted/COGS/valuation/reorder-qty + COGS & valuation totals. CSV export.
- [x] Staff reports: sales/waiter, orders handled, shift hours, tips — `/reports` Staff tab (`report_staff`, DEFINER owner/manager): revenue+orders per waiter (orders now record `waiter_id`), tips + shift hours from `staff_shifts`. CSV export.
- [x] Customer/loyalty reports: repeat rate, top customers, redemption — `/reports` Customers tab (`report_customers`): orders/spend per customer, points redeemed, **repeat rate**. CSV export.
- [x] Owner dashboard: KPI tiles + charts (web + mobile) — `/` dashboard (KPI cards + 7/14/30/90-day revenue **area chart**, low-stock/reservations/recent-payments) + `/reports` KPI tiles + breakdowns. **Mobile done (2026-07-30)**: the Flutter app renders the same `dashboard_summary` RPC (hand-painted chart, no charting dep), verified on the Android emulator light + dark + greyscale. See "Dashboard moved into Postgres" above and `../extrahelper_flutter/TASKS.md` Milestone I.
- [x] Exports: CSV / PDF — `ExportButtons` (CSV download via `lib/csv` + Print/PDF via browser print, `print:hidden` chrome) on every report table.
- [~] **Verify:** report totals reconcile vs seeded transactions across all windows — **verified E2E**: revenue $30.70 / 2 orders / avg $15.35 / service $2.90 / discount $1.20 reconcile against the 2 paid E2E bills; top items (Burger ×2 $24, Fries ×1 $5); Cash $30.70; window switch recomputes. RLS-scoped (non-member → zeros). TODO: multi-window seeded reconciliation.

## Milestone 5 — Customer Channels
- [x] QR dine-in ordering page: scan → menu → order → (optional) pay-at-table; call-waiter / request-bill — public `/t/[token]`: `qr_menu()` + `place_qr_order()` + `qr_request_bill()` (→ table bill_requested) + `submit_feedback()`, all anon token-scoped SECURITY DEFINER. Cart → 'qr' order → POS; post-order Request-bill + star feedback. **Verified E2E** (browser + anon MCP). TODO: pay-at-table (gateway, M6). (`20260711014523_qr_ordering`, `20260711021134_public_actions`)
- [x] Reservations/booking: date/time/party size, availability from floor capacity + slot rules, confirm + reminder (email/SMS), host board, optional deposit — `/reservations` host board (book→confirm→seat→table occupied) + **public `/book/[slug]`** (anon `create_public_reservation`). **Verified E2E** (browser host board + anon MCP booking). TODO: availability/slot rules, email/SMS reminder (notification adapter), deposit. (`20260711021134_public_actions`)
- [x] Online storefront (per-tenant subdomain/slug): menu, cart, address, delivery/pickup slot, order-type fee — public `/s/[slug]` (`storefront_menu`/`place_online_order` anon SECURITY DEFINER): cart, pickup/delivery toggle, name/phone/address, order-type fee from settings → creates `online_orders` + order. **Verified** (browser render + anon MCP order). TODO: delivery/pickup time-slot picker. (`20260711020634_storefront`)
- [x] Delivery status tracking — `/online` staff board (`app/online/actions.ts`): status flow received→preparing→ready→out_for_delivery→delivered, dispatch (driver → `delivery_tracking`). Tenant-scoped. TODO: customer-facing tracking page.
- [x] Loyalty/CRM: customer accounts, points earn/burn, tiers, offers/coupons, order history, post-visit feedback/ratings — `/loyalty` (`loyalty_adjust()` manager-gated trusted fn): earn/redeem points, auto-tier (bronze/silver/gold), feedback list; QR star feedback feeds it. **Verified**: earn 150 + burn 50 → 100 pts silver, overdraw blocked. TODO: coupons/offers redemption, order-history view. (`20260711020954_loyalty`)
- [ ] Multiple menus (dine-in vs delivery pricing, happy-hour) + schedules
- [~] **Verify:** QR/online order lands in KDS; reservation blocks table → seat → bill (E2E) — QR order → POS/KDS ✅; online order → `/online` ✅; reservation → seat → table occupied ✅. TODO: full reservation→bill chain E2E.

## Milestone 6 — Payments & SaaS Monetization
- [x] Online payment gateway adapter (Stripe + regional e-wallet), per-tenant config, sandbox first — pluggable `PaymentGateway` interface + `sandboxGateway` (`lib/integrations/payments.ts`); `payByCard` on `/bill` charges via gateway → records 'online' payment. Real Stripe/eSewa/Khalti = same interface, registered by key (per-tenant config). **BLOCKED (open Q §9)**: which gateway to launch + API keys. TODO: per-tenant gateway selection in settings, webhook reconciliation. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Customer payment flows (QR pay-at-table, online prepay) + webhook reconciliation — online card charge via sandbox gateway wired (staff `/bill`). TODO: customer-facing pay-at-table (QR) + online-prepay UI (needs gateway decision), webhooks. ✅ Finished in partial-features sprint (2026-07-13).
- [x] Loyalty points as payment method — **pay-with-points on `/bill`** (`components/bill-loyalty.tsx`). New `redeem_points_for_bill()` RPC (migration `20260713090000`) burns points + records a `'points'` payment **atomically**, capped by both the account balance and the outstanding due, idempotent, gated on `payment.take` (cashier-usable, unlike manager-only `loyalty_adjust`). Configurable rate `tenant_settings.points_value_cents` (default 1 = 1pt→1¢, region-agnostic). Dine-in orders carry no customer, so `attach_bill_customer()` (match-by-phone or create → set `orders.customer_id`) lets the cashier attach one first. Bill page loads the order's customer + balance; panel shows balance, redeemable cap, and cash-equivalent. Types regenerated. TODO: wallet method; earn-on-bill loyalty accrual.
- [x] Subscription plans (Starter/Pro/Enterprise), per-branch/per-seat, monthly/yearly, trial — 3 plans seeded (features+limits jsonb); `subscribe_tenant()` (owner/platform-admin), monthly/yearly. `/billing` UI: current plan, compare, upgrade. **Verified E2E**: Pro→Enterprise upgrade in browser. (`20260711022122_subscriptions`)
- [x] Platform subscription billing + invoices + dunning — `subscribe_tenant` issues `platform_invoices` (sandbox = paid). **Verified E2E**: Enterprise upgrade → $99 Paid invoice shown on `/billing`. **Dunning done**: `run_dunning()` (pg_cron daily 03:00 UTC) flips `active→past_due` at period end, suspends after 7-day grace; `/admin` 'Run dunning now' button (`trigger_dunning`, platform-admin) + past_due badge (`20260712050000`). Verified: backdated sub → past_due, cron job scheduled.
- [x] Feature gating by plan (feature flags) — `tenant_has_feature()` (trial unlocks all; else plan.features); `requireFeature`/`tenantHasFeature` guards. `/loyalty` + `/online` gated → redirect `/billing` if not entitled. **Verified** (MCP: enterprise unlocks multi_branch, Pro gates it).
- [x] Super-admin: usage metrics, audited impersonation — `/admin` metrics + plan assignment + suspend/activate (audited). **Impersonation done**: `getActiveTenant` honors an `impersonate-tenant` cookie for platform admins only (RLS already grants cross-tenant read); `start/stopImpersonation` audited (`impersonate` action), 'View as' button + amber banner with Exit; audit_logs_insert RLS gains `is_platform_admin()` escape (`20260712040000`). TODO: deeper usage analytics.
- [x] **Verify:** trial → upgrade → gateway sandbox charge → feature unlocks (E2E) — **verified**: `/billing` Pro→Enterprise → $99 invoice paid → multi_branch feature unlocked (MCP). Sandbox gateway charge path wired on `/bill`.

## Milestone 7 — Hardening & Scale
- [x] Offline queue + sync (waiter/cashier): local persist, idempotency keys — **Web queue+reconnect done**: `lib/offline/queue.ts` (localforage/IndexedDB, retry cap `MAX_ATTEMPTS`) + `OfflineSyncProvider` (online/offline, replays queued orders/payments on reconnect, idempotent, drops stuck entries) + header offline badge. **Offline order-taking**: `QuickOrder` composer on `/pos` builds a full order (table + items) online AND offline; menu+tables cached to IndexedDB (`menu-cache.ts`) so a warm tab orders offline → online `place_staff_order` (dedup), offline enqueue+replay. **Payment**: bill cash payment queues offline; `takePayment` client key (was server-minted → double-charge). Installable PWA: manifest + maskable 192/512 + apple-touch (sharp), minimal SW (prod-only), proxy allows icon files. Migrations `20260712020000`, `20260712070000`. Verified: 2× same-key order → 1 row; build clean. **Adversarial-review hardened**: online writes reuse one idempotency key across retries + network-throw falls back to enqueue(same key) (no dup / no lost order / no double-charge); replay separates server-reject (drop after cap) from transient (never burns cap) + re-checks online mid-loop; `place_staff_order` rejects foreign table_id; **SW never caches authenticated navigations** (shared-tablet cross-user leak) → static `/offline.html`. Accepted LOW: replay uses authoritative server price + skips 86'd lines silently. Native offline still lives in the Flutter app later.
- [x] Multi-branch rollups (per-branch + tenant aggregate) — `report_by_branch()` (RLS-scoped) + "By branch" section on `/reports`. **Verified**: $30.70 Unassigned rollup. (`20260711024103_report_by_branch`)
- [x] Performance: POS/KDS < 200ms perceived, optimistic UI, report pagination — **Realtime** on KDS + POS + tables (authed socket + client-state merge/refetch, not `router.refresh`; `restaurant_tables` published `20260712010000`). **Optimistic UI** (`useOptimistic`) on POS item add/remove, table state, KDS bump + sonner error toasts. **Report pagination**: `report_top_items` `_limit/_offset` + prev/next + custom date range + tenant-tz ranges; dashboard 7/14/30/90-day window (`20260712030000`). Proxy allows PWA static files (`manifest`/`sw.js`/`icon`) unauthenticated. TODO: report queries still capped elsewhere; deeper perf profiling; Broadcast-from-DB if per-client RLS realtime cost grows.
- [x] Full audit/compliance polish — `/audit` viewer (owner/manager): voids/discounts/refunds/plan-changes/suspend with actor + metadata + tenant-tz timestamps. `writeAudit` used across void/discount/refund/tenant-status/plan-change. **Verified E2E**: void + discount entries shown.
- [x] Localization: currency/number/date formats, i18n string scaffolding — tenant `timezone` plumbed through `getActiveTenant`/`ActiveTenant` → `formatDateTime(iso, tz)` across receipts/cash/reservations/online/loyalty/billing/audit; `money()` pinned locale. **Verified E2E**: reservation renders 9:15 AM (America/New_York) not UTC. TODO: full i18n string extraction, per-locale number formats.
- [x] Security pass: RLS coverage audit, secret handling, PII minimization — **RLS: 0 of 52 tables uncovered** (audited repeatedly); all SECURITY DEFINER fns `search_path`-pinned + least-privilege (anon only on intended public API); **active-tenant scoping** added to all list pages (`.eq tenant_id`) beyond RLS. Publishable key only client-side (service role never exposed). TODO: PII minimization pass, secret rotation policy, remaining mutation-action tenant filters.
- [!] Mobile store release (Apple Developer + Google Play) — Flutter app + store accounts. Toolchain blocker cleared (2026-07-26, see Milestone 0); **now blocked on the accounts only** (Apple Developer $99/yr, Play Console $25 one-off) and on the app reaching a shippable state. Bundle id `com.extrahelper.app` is fixed on both platforms — changing it later means a new Play listing and a new iOS app record. Tracked in `../extrahelper_flutter/TASKS.md`.

---

## UI/UX & Polish (post-M7)
- [x] Root auth-gate: removed `/dashboard`, moved to `/`; logged-out → redirect `/login` (proxy `PUBLIC_EXACT` cleared, dashboard page + proxy updated).
- [x] Printable table QR **image** — `components/table-qr.tsx`: `qrcode` lib → PNG data-URI (CSP-safe, no CDN), encodes `/t/{token}`; Print (DOM API, no `document.write`) / Download / Copy-link. Wired into `/tables`. QR token is permanent (print once, stays on table).
- [x] **Consistent app shell** — route group `app/(app)/` with shared `layout.tsx` (auth once + `AppSidebar` + `SiteHeader`); all 16 staff routes moved in (URLs unchanged). Dashboard stripped to content-only. `SiteHeader` shows dynamic page title via `usePathname()`. Public routes (login/signup/onboarding/t/s/book/receipt) stay outside → no sidebar.
- [x] **KDS fullscreen** — `components/kds-board.tsx`: Fullscreen button → `requestFullscreen()` on the board (edge-to-edge tickets, sidebar hidden), Esc restores; keeps auto-refresh.
- [x] **Page-shell standardization** — `components/page-header.tsx` (`PageShell` + `PageHeader`) adopted by all 16 pages. One width policy: standard `max-w-5xl`, narrow `max-w-lg` (settings/cash/bill); killed scattered `max-w-2xl/lg/4xl/5xl` + duplicated heading markup. Dashboard + KDS full-bleed by design.
- [x] **Per-user appearance: dark mode + text-size** — new `user_preferences` table (`user_id` PK, `theme`, `text_scale`, RLS own-row only; migration `20260711030000_user_preferences`). Header controls (`AppearanceControls`): A−/A+ (5 sizes 14–20px on root `<html>`, whole-app scale) + Sun/Moon toggle. Persist per-user in DB (`savePreferences` action) + mirrored to httpOnly cookies → root layout SSR-paints theme+size **no-flash**; follows login across devices. `PreferencesProvider` seeds from DB, applies optimistically. `next-themes` left installed but unused at runtime (DB is source of truth). **Verified**: tsc + build clean; advisors show no new RLS warnings; table has RLS + self-policy + updated_at trigger.
- [x] **Real dashboard** (`/`) — replaced the Next template mock (deleted `section-cards`, `chart-area-interactive`, `data-table`, `data.json`) with a live restaurant ops dashboard (server component, tenant-scoped + RLS): 4 KPI cards (revenue today + vs-yesterday delta, paid orders + avg, active orders + open KOTs, low-stock count), 14-day revenue area chart (`DashboardRevenueChart`, recharts + shadcn ChartContainer, tz-aware daily buckets via `Intl` — no migration), + low-stock / upcoming-reservations / recent-payments lists. `force-dynamic`, theme + text-scale aware. **Verified**: tsc + build clean; renders real seed data (₹6,217.50 today). Fixed KPI grid (`sm:grid-cols-2 xl:grid-cols-4` — container-query variants misfired without `@container/main`).
- [x] **Demo seed data** for tenant "D raj" (clixacom@gmail.com, INR/Asia-Kolkata) — via MCP `execute_sql` (remote rows, not a migration): 4 stations, 4 categories, **20 Nepali sekuwa + beer menu items**, station routing, floor + 6 tables; live POS/KDS orders (T1 in_kitchen, T2 preparing, T3 draft) → 6 KOTs across grill/bar/kitchen; 12 inventory items + 11 recipes/BOM (3 low-stock); 3 paid bills + payments (today revenue); 5 customers + loyalty; 3 reservations; 2 online orders (delivery w/ tracking + pickup); 2 cash sessions. Tenant set to **Enterprise** plan (features unlocked). Note: demo rows are remote-only — **not seeded in `supabase/seed.sql`**.
- [x] **Notifications** — header **bell** (`NotificationBell`) with live badge = count of orders awaiting acknowledgement (`status='placed'`, incl. QR self-orders); new order → badge + toast, auto-clears when opened/fired; realtime off the authed socket; hidden for roles that can't open the screen (kitchen/inventory/receptionist). **`/notifications` screen** (`NotificationTabs`): **Order** tab (recent orders, live) for owner/manager/cashier/waiter + **Activity** tab (`audit_logs` feed, live) owner/manager only (hidden otherwise, matches RLS). `audit_logs` added to realtime publication (`20260712080000`); `ACTION_STYLES` extracted to `lib/audit-constants.ts`; sidebar nav item. No migration for orders (already published). **Verified**: tsc + build clean; both tabs realtime.

- [x] **Team + custom roles + granular permissions** (RestroX-style Users & Roles). **Architecture**: existing `app_role` RLS stays the security floor; custom roles carry a `base_role` that bounds DB access, and a granular **permission matrix** refines at the app layer (can only restrict within the base role). **Schema** (`20260712090000`+`_091000`+`_092000`+`_093000`): `permissions` catalog (35 keys grouped), per-tenant `roles` (name/color/base_role/is_system) + `role_permissions`, `user_tenants.role_id`+`status`, `staff_invites`; 7 default system roles seeded per tenant (mirroring current requireRole behavior) + backfill; RPCs `has_permission`/`get_my_permissions` (base-role fallback), `list_tenant_members` (emails via auth.users), `add_member_by_email`/`set_member_role`/`approve_member`/`remove_member`/`cancel_invite`/`claim_invites` (owner/manager + **last-owner** + **owner-only-modifies-owner** + **verified-email-invite** guards — from commit security review). **App layer**: `requirePermission` guard replaces requireRole on all 17 pages; `PermissionProvider`/`useHasPermission` gates sidebar nav + buttons; money-ops (void/discount/refund/payment) gated; pending memberships excluded from access until approved. **UI**: `/team` — role cards + `RoleEditor` (permission matrix, system roles read-only) + staff table (add by email → attach or pending-invite, admin approves — no email required). **Verified**: tsc+build clean; RLS on all new tables; 35 perms/7 roles seeded; owner→"Owner" role. **RPC-level enforcement**: `has_permission` gate added inside the sensitive DEFINER RPCs (`void_order_item`/`apply_bill_discount`/`refund_payment`/`record_payment`, `20260712100000`) so granular denies hold even against direct API calls (not just the UI). Verified: 4 RPCs gated; cashier default can pay but not void, manager can void. ⚠️ **The `apply_bill_discount` gate was later reverted by two `create or replace` redefinitions and was missing on prod until 2026-07-31** — see "`apply_bill_discount` lost its permission guard" above. The other three held.

- [x] **POS order flow → modal-driven, one-shot create** (2026-07-16). Replaced the two-surface flow (compose on `/pos` → navigate to `/pos/[orderId]` to reach variants/modifiers) with one composer. **Schema/RPC** (`20260716090000_pos_order_flow`): `orders.guests` + sanity check; `place_staff_order` dropped and recreated at 10 args — per-line `variant_id`/`modifier_ids`/`notes`/`course`/`seat`, off-menu custom lines (`item_id` null, price clamped 0–10M), order-level `guests`/`waiter`/`customer` (explicit id tenant-checked, else find-or-create by phone mirroring `attach_bill_customer`); rejects non-dine-in/pickup and table+pickup contradictions; replay fast-path returns before any write so a re-send can't mutate a committed order or orphan a customer. **This finally sets `waiter_id`** — the only previous writer was the dead `startOrder` (deleted), so every order until now had `waiter_id = null` and the staff report was silently empty. `20260716091000_list_order_staff`: narrow names-only reader, because `list_tenant_members` is owner/manager-gated and returns **zero rows with no error** for the waiters who'd use the picker. **App**: `components/ui/dialog.tsx` (new Base UI primitive, `size` prop incl. fullscreen, 100dvh); `components/pos/*` — modal owns create *and* amend via a capability-shaped `CartController` (create batches locally → one atomic call; amend fires each edit as a server action, since a fired line needs a reasoned + audited void). `/pos` is now a Realtime card grid; `/pos/[orderId]` a deep link onto the same screen. Offline preserved: cache + queue fields all optional so an older build's IndexedDB blob still deserializes and replays. Deleted `quick-order` (291), `pos-builder` (611), `pos-active-orders` (76), `destination-picker` (106). **Verified**: RPC pricing parity vs `addItem` to the cent (38000 base + 130000 variant + 15000 + 5000 mods = 188000, `name_snapshot` "Buff Sekuwa (KG)", both modifier rows snapshotted); 11 negative cases raise correctly (cross-tenant table/customer/waiter, price clamps, order-type guards, variant-from-another-item); idempotent replay returns same id and adds no lines; grants are `authenticated`-only on the new signature; tsc + lint + build clean.

- [x] **POS tile price range + variant dialog + veg marker** (2026-07-16). **Fixed a live bug**: the tile showed `base_price_cents`, but the options dialog *forces* a variant when one exists (`variants[0]` preselected, no "none" chip) — so Buff Sekuwa advertised NPR 380.00 when the only orderable prices were 1,080 and 1,680, and the `aria-label` read the same unbuyable figure to screen readers. Now `moneyRange()` (`lib/format.ts`, built on `money()` so the pinned locale carries) + `itemPriceRange()` (`cart-types.ts`, base + min/max delta; add-ons excluded since they're optional) → "NPR 1,080.00 – 1,680.00", currency collapsed because the repeated prefix cost three lines of wrap on a tile read at arm's length. **Second bug found while testing**: the create-mode cart rendered `line.name` and never `variantName`, so two lines both read "Buff Sekuwa" and differed only by unit price — `cartLineTitle()` now folds the variant in for display + all aria-labels (a no-op in amend mode, where the server's name_snapshot already has it). **Dialog** matches the reference: thumbnail + category + inline qty stepper in the header (`pr-12` to clear DialogContent's absolute close button), "Select variant" not "Size", cooking-request textarea. New `dish-thumb.tsx` extracts `monogram()` so tile and dialog can't drift. **Veg marker** (`20260716100000_menu_item_is_veg`): `is_veg boolean` **nullable** — copying `is_86`'s `not null default false` would have silently labelled all 23 seeded dishes non-veg, Dal Bhat included; null = unmarked = render nothing. Tri-state Select in the item editor (a Checkbox can't express "unmarked"). `veg-mark.tsx` uses **circle vs triangle** — a red/green dot is colour alone and red/green is the most common colourblindness. **Verified**: tile range matches the chips exactly (low = Half KG, high = KG); no-variant dishes stay single-price; all 23 items null → zero marks before any edit; marked 2, reopened the sheet to confirm round-trip (the `as never` cast in menu/page.tsx would have hidden a missing column); shapes distinguishable with `grayscale(1)` applied; signature test still green (KG ×2 merged, Half KG separate, focus + caret survive 16 keystrokes). tsc + lint + build clean.

## Backlog / Discovered
- [x] **`tenant_day_start(_tenant uuid, _at timestamptz)` added** — `20260814070000_tenant_day_start.sql`, for the Flutter POS parity sweep (mobile Milestone O). Returns the UTC instant of local midnight for a tenant's `tenant_settings.timezone`, so the Completed tab and the settled-bills list can be capped to "today" the same way the web's `tzDayStart` caps them. SECURITY DEFINER because it reads `tenant_settings` (checked against `current_tenant_ids()` / `is_platform_admin()`, 42501 otherwise), `revoke execute from public, anon` + grant to `authenticated` naming the full signature. Written in SQL rather than Dart for the reason `dashboard_summary` already documents: `package:intl` has no IANA timezone database, and a boundary deciding which orders a waiter can see must not exist twice. **The web does not use it yet** — `tzDayStart` still computes the same boundary in TypeScript. Worth moving the web onto it so there is one implementation, not two that agree today.
- [ ] **`bill_status` has no `refunded` value** — the enum is `open | partial | paid | void`, but `billStatusLabel` in `lib/order-constants.ts` (and its Flutter mirror) maps a `refunded` key that no row can ever hold. Harmless where it is a label, but it reads as a filterable status and is not: filtering on it is a runtime 22P02. Either add the enum value where a refunded bill should be distinguishable from a paid one, or drop the label from both clients. Found 2026-08-14 while building the mobile Bills filter, which deliberately omits it.
- [x] **`addCustomItem` moved onto a trusted RPC** — `20260813150000_amend_order_add_custom_item`. It used to insert straight into `order_items` behind `requireRole(...)`, and a role check inside a server action is not a guard: RLS on `order_items` is tenant-scoped only, so the same row could be written through PostgREST with a caller-chosen price and no audit row. The RPC (SECURITY DEFINER, `revoke from public/anon`, granted to `authenticated`) re-checks the role **and** `order.create`, refuses a billed/closed/cancelled order, clamps name and price, and writes the `custom_price` audit in the same transaction as the line — mirroring the custom branch of `place_staff_order`. `addCustomItem` now just validates and calls it, so the web and the Flutter app share one implementation. Verified: ACL is `postgres=X | authenticated=X | service_role=X`; `tsc --noEmit` clean.
- [ ] **`payByCard` has no client-callable path** — discovered 2026-08-13 while shipping checkout in the Flutter app. Charging a card online runs through `getGateway` inside a server action (`app/(app)/bill/actions.ts`), so only the web can do it; the mobile app deliberately omits the `online` method rather than record a payment it never collected. Fix is an Edge Function wrapping the adapter, or a `charge_card` RPC. Until then, card-online is a web-only capability and should be described as one.
- [ ] **`refund_payment` takes no idempotency key** — it is the only money-moving RPC without one, so a client that loses the connection mid-refund cannot safely retry, and both clients have to fall back to "check the payments first". Adding `_idempotency_key` with the same `unique(tenant_id, idempotency_key)` treatment `record_payment` has would make refunds retry-safe everywhere. Raised 2026-08-13.
- [ ] **`enqueue_kot_print` always emits the full KOT** — the trigger's second insert (`20260731160100_printing_v2.sql:650`) fans `full_kot` out to every printer holding that document, regardless of whether the same printer already took the station ticket for that order. Assigning both docs to one printer is therefore two tickets per fire, which reads as a bug to the restaurant even though it is the documented meaning of the assignment. Considered and **not** changed 2026-08-13 (unticking "Full KOT" in Settings → Printers is the intended switch), but worth revisiting as a guard in the trigger or a clearer warning in `printer-sheet.tsx`.
- [x] **Active-tenant scoping / defense-in-depth**: added `.eq("tenant_id", tenant.tenantId)` to every direct `.from()` query/mutation that lacked it, so a multi-tenant user's active tenant never mixes rows. **Swept all pages** (agent-enumerated): `/reservations`, `/kds` (bump/recall), `/menu` (toggleItem86, deleteItem), `/tables` (setTableState, deleteTable), `/pos` (startOrder table-occupy, **addItem menu_items SELECT** — was load-bearing: its name/price snapshot into `order_items`, removeItem), `/cash` (both `cash_sessions` SELECTs). Verified inserts all set `tenant_id`; RPCs enforce tenant internally; `/admin` is platform-level (`requirePlatformAdmin`, no tenant_id). (RLS already blocked cross-tenant — this is correctness + depth.)
- [x] **Void after fire restores ingredient stock** — `void_order_item` now, when a line was fired (a `sale` movement exists) and not already restored, adds recipe qty back to `inventory_items` + logs a compensating `adjustment` movement tagged `void:<order_item_id>` (idempotent — restore-once). (`20260711040000_void_restores_stock`). **Verified**: Chicken 25 → fire −1.0 → 24 → void → 25.
- [x] **Negative stock surfaced** — deduction still allows negatives (keeps theoretical-usage truth), but oversold items (`current_qty < 0`) now show a red "oversold" badge + a banner count in `/inventory` (distinct from amber "low stock"). Dashboard low-stock count already includes them. **Optional hard-block done**: per-tenant `block_negative_stock` setting toggle; when on, `trg_deduct_stock` rejects a fire that would drive an ingredient below zero (`20260712060000`). Verified: block on + oversell → rejected.
- [x] `adjustStock` made atomic — new `adjust_inventory(_item,_delta,_type,_reason)` SQL fn (SECURITY INVOKER, RLS applies) does `current_qty = current_qty + delta` + movement log in one statement; the app action calls it via RPC (no more read-modify-write race). (`20260711040100_adjust_inventory_atomic`). **Verified**: +5 on Rice, movement logged.
- [x] Locked trigger fn `trg_deduct_stock` to no-execute (migration `20260710195814`). **Re-verified 2026-07-13**: after the fn was redefined in `20260712060000` (block-negative-stock), the ACL is still `{postgres=X, service_role=X}` — anon/authenticated/public have no EXECUTE (create-or-replace preserves ACL; no re-grant). Reminder stands: every new SECURITY DEFINER fn needs an explicit `revoke execute from anon`.
- [x] Signup email-confirm flow — `signup` now detects no-session (confirmation required) and shows a "Check your email" screen instead of bouncing to `/login`; sets `emailRedirectTo` → new route `app/auth/confirm/route.ts` handles both `token_hash`/verifyOtp and `code`/exchangeCodeForSession, then redirects; bad/expired link → `/login?error=confirm` notice. **Note:** for the token_hash flow set the Supabase confirm-email template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/` (dashboard config). **Resend button** added on the confirm screen (`resendConfirmation` action → `auth.resend`).
- [x] Handle signup errors gracefully in UI: `signup` action now validates email shape (`EMAIL_RE`) before hitting Supabase, and maps terse auth errors via `friendlyAuthError` — rejected domains (.dev/.local/disposable → `email_address_invalid`) → "try another email", already-registered → "sign in instead", weak-password → guidance. Errors already render in `signup-form.tsx`. → Milestone 0 auth
- [ ] Remove test user `extrahelper.demo.owner@gmail.com` + demo tenant `extrahelper-test-diner` (owner-provisioned via onboarding) before real data seeding — **now a launch gate**, see "Single-environment decision" above: this project is prod, so the probe rows and the paying customers share a database.
- [ ] Browser UI E2E for `/onboarding`, `/settings`, `/admin` — DB paths + guards verified via MCP/typecheck/build, but Chrome extension disconnected mid-session; drive the real pages next time. → Milestone 0
- [x] Seed a `platform_admins` row so `/admin` is viewable — **granted to clixacom@gmail.com** (user-confirmed target; grants cross-tenant super-admin). `insert into platform_admins(user_id) values ('a1328472-…')`.
- [x] Fine-grained per-action RBAC write gating — **superseded by the Team + custom roles work** (see "Team + custom roles + granular permissions" above): `requirePermission` gates all 17 pages, `has_permission` gates the sensitive DEFINER RPCs (`void_order_item`/`apply_bill_discount`/`refund_payment`/`record_payment`), and the UI hides ops a role can't do. Cashier default can pay but not void; manager can void.
- [x] Settings editors for tax rules + receipt template — `/settings` now edits `tenant_settings.tax_rules` (variable list of {name, rate, inclusive} via a rows editor serialized to a hidden JSON field) + `receipt_template` (header/footer/terms); `updateSettings` validates + persists. Region-configurable (rule #2).
- [x] Tenant switcher — `getActiveTenant` now reads an `active-tenant` cookie (validated against memberships) instead of always the first; `getTenantMemberships()` + `switchTenant` action (membership-checked, sets cookie); `TenantSwitcher` dropdown in the sidebar header, shown only when a user belongs to >1 tenant (else the single tenant name / logo).
- [!] Enable Supabase Auth **leaked-password protection** (HaveIBeenPwned) — **BLOCKED: requires Supabase Pro plan.** Confirmed via Management API `PATCH /config/auth {password_hibp_enabled:true}` → "available on Pro Plans and up." Project is on Free. Enable after upgrading the Supabase project to Pro (pre-launch). No code/config path on Free.
- [x] Locked SECURITY DEFINER helpers to `authenticated` only — `revoke ... from anon` was ineffective (Postgres grants EXECUTE to PUBLIC by default); fixed by `revoke from public` + `grant to authenticated` (migration `20260710181544_lock_definer_execute`). Anon advisor warnings cleared. Remaining `authenticated`-execute WARN is by design (RLS policies + onboarding RPC require it).
- [x] Anon-facing QR surface — done via SECURITY DEFINER fns (`qr_menu`/`place_qr_order`) that scope anon to the token's tenant, instead of broad anon RLS. Same pattern for future public surfaces (storefront). `/t` added to proxy public prefixes. Verified: foreign-item injection skipped, price from menu, negative qty clamped, all-invalid → atomic rollback (no orphan order). Note: `qr_menu`/`place_qr_order` show advisor 0028 (anon-executable SECURITY DEFINER) — INTENTIONAL (they ARE the public API).
- [x] QR order abuse hardening — `place_qr_order` now caps qty per line (≤20), lines per order (≤40), and rate-limits to 3 QR orders per table per 30s (errcode 53400). (`20260711040200_qr_order_limits`). TODO: consider IP-based limits + captcha at scale.
- [x] **Tenant-timezone display**: `ActiveTenant` carries `timezone`; `formatDateTime(iso, tz)` + every caller already pass `tenant.timezone` (render side). **Fixed the input side**: `datetime-local` values (reservations `/reservations` + public `/book`) were parsed as server-UTC wall time, storing the reservation hours off. Added `zonedTimeToUtc(wall, tz)` in `lib/format.ts` (interprets naive wall time in the tenant zone via `Intl` offset); applied in both reservation actions. Public `/book` gets tz via `storefront_menu` (now returns `timezone`, migration `20260712130000`). **Verified**: 7PM Asia/Kolkata → stored 13:30Z → renders 7PM. (`money()` locale still en-US = separate i18n line.)

- [x] **Modifier↔item link is now validated** (2026-07-20). Both `addItem` (`app/(app)/pos/actions.ts`) and the `place_staff_order` port now require every requested modifier to be linked to *this item* via `item_modifiers`, not merely owned by the tenant — so "Extra cheese" can no longer price onto a beer. Both reject the whole line rather than silently drop the stray add-on (till total and kitchen ticket can't disagree). RPC uses `count(*) <> cardinality(_modids)`; TS uses `links.length !== modifierIds.length` — same logic. **Verified**: grant test (10-arg RPC off anon/public, no stale overload); guard arithmetic (linked-only accepted, any-unlinked rejected in all 4 cases); pricing math unchanged so cent-parity preserved by construction. tsc+lint+build clean. (`20260720090000`)
- [x] **`attach_bill_customer` no longer clobbers a set `customer_id`** (2026-07-20). Now returns the existing customer id and leaves the row untouched when the order already has one (POS sets it at create) — reassignment must be a deliberate action, not a side effect of a cashier attaching by a different phone. (`20260720091000`)
- [x] **High-value custom lines are audited** (2026-07-20). Every off-menu (`item_id`-null, hand-typed price) line now writes an `audit_logs` row `action='custom_price'` with name/price/qty/order — both the create path (`place_staff_order`, `20260720090000`) and the amend path (`addCustomItem`). Rule #5 satisfied. Audited all custom lines (rare + staff-typed) rather than pick an arbitrary threshold.
- [x] **Veg marker reaches customers** (2026-07-20). `qr_menu` + `storefront_menu` now emit `is_veg` (nullable → unmarked renders nothing), and `/t/[token]` + `/s/[slug]` render `VegMark` (circle-vs-triangle, greyscale-safe) beside each dish name. **Verified**: both RPCs return the `is_veg` key; grants unchanged (anon = the public API, by design). (`20260720092000`)
- [ ] **`menu_items.spice_level` and `menu_items.allergens jsonb` are dead columns** — INVESTIGATED 2026-07-20, awaiting decision. Confirmed truly dead (only in generated `database.types.ts` + one comment; nothing reads/writes them). Owner asked whether spice_level/allergens should surface **on the KOT** rather than be dropped — neither is snapshotted onto `order_items` today, so surfacing on the ticket means either a join to `menu_items` at render or snapshotting at order time. Decide: drop both, or spec a "surface on KOT + item editor + public menus" feature.
- [x] **Browser receipt/KOT print came out on A4 with gutters — `@page { size: <w>mm auto }` is invalid CSS** (2026-08-07). `size` takes one length, two lengths, or the bare keyword `auto` — never a length *plus* `auto`, so Chrome dropped the whole declaration and kept Letter/A4. Verified by PDF MediaBox (Playwright `page.pdf({preferCSSPageSize:true})`): `80mm auto` → 215.9×279.4mm, `80mm 200mm` → 80.1×200.1mm, and nesting inside `@media print` is fine either way. `/kot/[kotId]` had shipped with the broken form since the print module landed, so **every browser-fallback ticket printed on A4**; `/receipt/[billId]` had no `@page` at all and sized its slip with `max-w-xs` (320px — a px width means nothing to a printer). Fix: `components/print/print-page-size.tsx` measures the rendered slip and injects `@page { size: <w>mm <measured h>mm; margin: 0 }` on mount and on `beforeprint` (+2mm slack; rounding the other way feeds a whole blank slip). Slip padding is `p-[2mm]` in **both** media so the measured height is the printed height — a print-only padding made the page 2mm too tall. `/receipt` also gained `print:min-h-0` (a `min-h-svh` wrapper printed a blank tail) and resolves paper width from the tenant's `bill`-document printer (`printer_documents ⋈ printers`, fallback 80). **Verified**: receipt PDF 80.1×67.1mm, 1 page, dashed rules 76mm of 80mm; KOT 80.1×55.0mm, 1 page, rules 75.9mm. ESC/POS path untouched — it was already full-width (`char.repeat(cols)`, 48 cols at 80mm). Note for future work: Chrome does **not** expose `size` through `CSSPageRule.style`, so CSSOM inspection cannot tell you whether the declaration parsed — check the PDF MediaBox.
- [x] **Payment QR + logo now actually print on receipts** (2026-08-13). The logo had been uploadable, previewable and *never printed* since the settings tab landed — `logo_url` was declared in `app/receipt/[billId]/page.tsx` and dropped, and `job-render.ts` destructured only `{header, footer, terms}`. Settings → Receipt & branding now takes a **payment QR** (FonePay/eSewa/bank) beside the logo, and both reach paper on every path. **The design decision that matters: images are rasterised once, at upload, in the browser — not at print time.** Only a browser has a canvas; the Android app (`render_client.dart`) and the headless agent (`tools/print-agent`) fetch finished ESC/POS and write it to a socket, so anything drawn at print time would appear on till-driven printers only and every phone-printed slip would come out blank where the QR should be. New `components/print/bake-image.ts` bakes one 1-bit bitmap **per paper width** (384/416/576 — a `GS v 0` image is printed at its own size, the printer will not scale it), each pre-padded to full width so centring is in the pixels (`ESC a 1` is unreliable for raster images on cheap clones). Stored under `receipt_template.print_assets`; new `image` `DocBlock` + cases in **both** renderer switches (`escpos-render.ts`, `raster.ts` — the raster one advances `y` in the measure pass too, or the ticket prints with its tail cut off). QR gets a hard threshold, logo gets Floyd–Steinberg (dithering a QR scatters its module edges; hard-thresholding a logotype makes a blob). **Trap paid for:** Otsu returns the *last level of the dark class*, so a clean black/white QR comes back with `cut = 0` — compared as `luma < cut` nothing is ever below it and the entire code baked out **white**. Caught only because the upload verifies the baked bitmap still decodes (`jsqr`, new dep) and refuses it otherwise; a printed-but-unscannable payment QR is a guest at the till who cannot pay, discovered mid-service. Fixed to `<=`. **Verified**: bake→pack→unpack→`jsQR` returns the byte-exact payload at all three widths, from a tight QR, one with a fat white margin, and a 140px source; `GS v 0` byte counts exact including band headers (13,272 / 15,624 / 29,912); a width with no baked variant degrades to printing the rest of the ticket. Total ~103KB of baked bytes per tenant, under the 200KB upload guard. Also fixed the **lost-update race** on `receipt_template`: the save bar and both uploads each did read-modify-write on one JSONB blob, so an upload in flight during a Save was silently dropped — all three now patch through `merge_receipt_template(uuid, jsonb)` (`20260813160000`, `security definer`, revoked from public, granted to `authenticated`; json null deletes a key). Flutter needs **no change** — the plugin already chunks Bluetooth writes at 16KB with per-chunk flush. Three more found on a second read-through: `PrintPageSize` measured the slip **before the images loaded**, so a branded browser-fallback receipt measured short by exactly the logo + QR and spilled a second slip (now re-measures under a `ResizeObserver`); `EscPos.raster` used `push(...bytes)`, putting ~30,000 bytes on the argument stack (now appended in a loop); and `removeBrandImage` left the object in the public bucket, so a "removed" logo was still served to anyone holding the URL (now deleted, with the path checked against the tenant's own folder). tsc + lint + build clean.
- [x] **POS customer picker is no longer capped at 200** (2026-07-20). New `searchCustomers` server action (name/phone `ilike`, ≤20, LIKE-wildcard + or()-grammar sanitized) backs a type-ahead `CustomerPicker` (`components/pos/customer-picker.tsx`) that replaces the flat `Select` in `check-in-details.tsx`. Empty query shows the shipped recent-200; typing searches the full book. Keyboard/outside-click close, `role=combobox`, chip+clear when picked. tsc+lint+build clean.

- [x] **The bill can be printed before it is paid** (2026-08-14). Checkout used to produce paper only *after* `status` flipped to `paid` (the `enqueue_bill_print` trigger), so the slip a guest actually reads — the one they check before handing over cash or a card — came from a browser page or not at all. Both clients now offer **Print bill** ahead of the payment button: web in `components/checkout/invoice-preview.tsx` (stacked, print above `Confirm checkout`), Flutter in `_DueBar` (beside the due figure, payment full-width beneath — stacking both pushed the bar over the body controls on a short screen, which the widget tests caught). **No new doc type and no renderer work:** `buildBill` already heads an unsettled bill "ESTIMATE" (`lib/print/docs.ts`), prints no tender lines when `payments` is empty, and leaves the drawer shut (`openDrawer` keys off a *cash payment*, of which there is none yet). Added only the disclaimer line the on-screen preview already carried, and the doc label now reads "Bill" unsettled. **Nothing is locked by printing** — a table that orders another round after asking for the bill is ordinary — so instead `enqueue_print_job` stamps `bills.bill_printed_at` + `bill_printed_total_cents` as it queues an unsettled bill (`20260814140000`), and both screens warn "the bill changed after it was printed" when that total no longer matches, flipping the button to **Reprint bill**. Two columns rather than a timestamp: `recompute_bill` never touches `updated_at`, so a note edit would have read the same as a new round of drinks. **Trap paid for:** the obvious `reprint:false` for a pre-bill would have deduped against the settled receipt — `enqueuePrint` builds `bill:<id>:<printer>`, byte-identical to the key `enqueue_bill_print` inserts — and the guest's actual receipt would never have printed. Pre-bill therefore carries no idempotency key, like every other reprint. Flutter suite green, `flutter analyze` clean, tsc + lint + build clean.

- [x] **A second discount replaces the first instead of stacking** (2026-08-14). `apply_bill_discount` inserted a row every call and `bill_discount_total` summed them, so a cashier correcting 10% to 20% took **30%** off — and comp-then-discount stacked a whole-bill comp under a percentage, which `least(discount, gross)` hid by clamping rather than fixing. A *staff bill discount* is now one slot, defined as `order_item_id is null and coupon_code is null`: `apply_bill_discount` and `set_bill_complimentary` clear it before inserting, `apply_item_discount` clears only that line's, and new `remove_bill_discount` / `remove_item_discount` take one back off (`20260814093000`). **A coupon is deliberately outside the slot** — the guest redeemed it, `apply_coupon` already refuses the same code twice, and silently voiding it would leave `coupons.used_count` incremented with nothing to show for it. `apply_bill_discount` also gained the settled-bill guard `apply_item_discount` already had; it had none, so a paid bill could still be discounted. Both new RPCs are `security definer` with `revoke execute from public` + grant to `authenticated` (revoking from `anon` alone does nothing). UI on both clients shows what is currently off with a **Remove** control, and the apply button reads "Replace discount" once something is there. **Verified**: 26 assertions driven through PostgREST as real signed-in users, so the `has_tenant_role` + `has_permission` gates are exercised rather than bypassed. `supabase/tests/discount_replace_and_remove.sh` (18) covers replace, remove, comp↔discount in both orders, coupon survives a staff discount *and* its removal, and a discount on one line leaving another line's alone; `supabase/tests/discount_guards.sh` (8) covers the refusals — a waiter cannot apply or remove, an owner of one tenant cannot touch another tenant's bill, a settled bill refuses both, an unknown bill is `P0002`, a genuinely anonymous call (no `Authorization` header at all, not an empty `Bearer`) gets `permission denied for function`, and removing a discount that isn't there is a no-op rather than an error. `pg_proc` checked for accidental overloads (none — all five keep their original arity) and every ACL confirmed `authenticated`-only. **Also fixed, found on review:** the new `discount_removed` audit action had no entry in either label map, so Flutter's manager log rendered the raw string `discount_removed` to staff (its fallback is `_ => entry.action`) — the rule is that enum values never reach staff. Added there and in `ACTION_STYLES`, along with `complimentary`, which had been missing the same way since comp shipped. Flutter suite green (249), `flutter analyze` clean, tsc + eslint clean.

- [x] **A QR order never reached the kitchen** (2026-08-14). `place_qr_order` wrote `orders` + `order_items` and stopped — the only writer of `kots` was `fire_order`, which no client calls for a guest order (POS fires what POS created). Both KDS boards read `kots`, so a table's QR order sat at `placed` on the orders board and the cooks saw nothing, forever. Found in live data: three QR orders ever placed, two of them with `kot_count = 0` (the third had been fired by hand). Fix (`20260814150000_qr_auto_fire`, remote `20260814074527`): the ticket-building half of `fire_order` moved into `fire_order_kots(_order_id, _tenant)` so the anon QR path can reach it without an `auth.uid()` membership check it can never satisfy — `fire_order` keeps its signature and both guards and now just calls it. New per-tenant `tenant_settings.qr_auto_fire`, **default true**: a guest order builds its tickets on placement and lands `in_kitchen`. Turn it off (Settings → General → Operations) and the order waits on the POS board behind a **Send to kitchen** button backed by new `accept_qr_order`, gated on `order.fire` + tenant membership, refusing a non-QR order and one already past the kitchen, and idempotent so a double tap on a flaky connection returns 0 tickets rather than an error. A tenant with no settings row is treated as auto-fire — a guest order the kitchen never sees is the worse failure of the two. `fire_order_kots` is revoked from `anon` **and** `authenticated` (only definer callers use it); `accept_qr_order` is granted to `authenticated` only. **Second trap:** this project's default privileges hand `anon` its own EXECUTE grant on every new function, so `revoke ... from public` left `accept_qr_order` anon-callable — the advisor caught it (`0028`) even though the call still failed, because `auth.uid()` is null and the membership check refuses it. The inverse of the rule already in CLAUDE.md: revoke from **both** `public` and `anon`, then check `pg_proc.proacl`. **Verified**: `supabase/tests/qr_auto_fire.sh` — 11 assertions over real PostgREST, as a genuinely anonymous guest (no `Authorization` header) and as signed-in staff: auto-fire on → tickets exist and the order is `in_kitchen`; off → no tickets, status stays `placed`, accepting builds one, accepting again is 0; anon cannot accept (42501), a waiter *can* (they hold `order.fire` — this is their job, so it is an allow-case proving the gate reads the permission and not the role), unknown order is `P0002`, and anon cannot call `fire_order_kots` directly (42501). Test orders deleted and the tables freed afterwards. The reported order (Table A1, 4 dishes) was repaired in place — one ticket, 4 lines, now `in_kitchen`. **Trap paid for:** a body written as `"$(cmd "{\"k\":\"$v\"}")"` inside an already-double-quoted argument reaches curl with literal backslashes and PostgREST answers `PGRST102` (bad body) instead of the guard's own SQLSTATE — build request bodies with `printf` into a variable first, as the discount suites do. Flutter suite green (250), `flutter analyze` clean, tsc + eslint clean.

- [x] **Three defects in the QR auto-fire change, found on a second read** (2026-08-14). (1) **Auto-fire could reject the guest's order.** Building tickets flips lines to `in_kitchen`, which is exactly what `trg_deduct_stock` fires on — with `block_negative_stock` on it raises `23514`, and unhandled that rolled back the entire `place_qr_order` call: the guest would see a staff-worded stock error and lose every other dish too. The fire is now wrapped in its own `begin/exception` block; on failure the order stands at `placed` and appears on the POS board behind **Send to kitchen**, which surfaces the real message to someone who can act on it. **Verified** with a temporary zero-stock ingredient wired to a demo dish: order created (1 line, `placed`, 0 tickets, stock untouched, no error to the guest), and `accept_qr_order` as the owner returned `23514 Insufficient ingredient stock to fire "Vegetable Momo"` — the error reaching staff, not the guest. Fixture (ingredient, recipe, settings row, order) deleted afterwards. (2) **The button ignored permissions.** Kitchen holds `order.view` but not `order.fire`, so it reaches `/pos` and was being offered a control `accept_qr_order` would always refuse — the rule is no permission, no control. Now gated on `useHasPermission("order.fire")` (web) and `hasPermissionProvider('order.fire')` (Flutter). (3) `accept_qr_order` was still **anon-callable** — see the grant trap noted above.

- [x] **Variants could only be added and deleted, never edited or reordered** (2026-08-14). Fixing a typo or a price on a size meant deleting the variant and retyping it — which orphans nothing but does lose the row every `order_items.variant_id` points at (`on delete set null`), so past orders quietly forgot which size was sold. And there was no order at all: `item_variants` had no `sort` column, so "Small / Large / Half" came back in whatever order Postgres returned and reshuffled between fetches; the Flutter POS papered over it by sorting on price delta, which is not the same thing (a Half is cheaper but often belongs last). New `sort integer not null default 0` + `(item_id, sort)` index (`20260814160000`), backfilled by price delta so no tenant sees a visual change on deploy. Menu editor rows now carry **edit** (inline name + price change, save/cancel), **move up** and **move down** — the open editor is held by id, not by a snapshot of the row, or revalidated values would not appear until the sheet was reopened. New `updateVariant` and `moveVariant` server actions (owner/manager, `revalidatePath` on `/menu` + `/pos`). `moveVariant` **renumbers the whole item 1..n** instead of swapping two rows: legacy rows can share a `sort` (the column defaulted to 0 before the backfill) and a swap between two equal values is a silent no-op. `addVariant` appends at `max(sort)+1`. Both reading paths now order explicitly — `.order("sort", { referencedTable: "item_variants" })` on `/menu` and `/pos` — and Flutter's `PosVariant` gained `sort`, ordering by it with price delta as the tie-break — **including the offline cache**, which is the half that would have gone stale silently: the drift `CachedVariants` table had no `sort`, so a waiter's phone would have shown the owner's order online and price order the moment it dropped off the network (drift schema **v4**, `addColumn` in the upgrade path rather than a fresh file — dropping the file takes the outbox, and the outbox may hold a real order). **Verified**: migration applied and backfill checked in live data (every item numbered 1..n in price order, no orphans, no `sort = 0` left); the reorder algorithm exercised on both a numbered list and an all-zeros legacy one, including both edges; PostgREST nested-order syntax checked on the built URL (`item_variants.order=sort.asc`); a temporary item + variants driven through the update and renumber statements against the live DB and deleted afterwards; new cache test asserts the owner's order survives a save/read round-trip where price order would give the opposite answer. Flutter suite green (256), `flutter analyze` clean, tsc + build clean, lint unchanged (7 pre-existing errors, none in menu files). **Not covered by an automated test**: the two server actions themselves — they are Server Actions, not RPCs, so the PostgREST suites cannot reach them.

- [x] **A role check in a server action was the only thing stopping a waiter repricing the menu** (2026-08-14). Every menu table carried the stock `tenant_all` policy — one `for all` rule whose only test is tenant membership — so `requireRole("owner","manager")` in `app/(app)/menu/actions.ts` guarded the button and nothing else: a waiter's own token could `PATCH /rest/v1/item_variants` and halve a price, or `DELETE` a size, straight through PostgREST. Verified against the live DB before the fix. Policies split (`20260814170000`): **read stays open to every member** — the POS, the KDS and the phone's offline cache all depend on it — and insert/update/delete on `menu_categories, menu_items, item_variants, item_modifiers, item_availability, item_station_routes, modifiers, combos, kitchen_stations, menus, menu_schedules, menu_item_prices` now require `has_permission(tenant,'menu.edit')`. `recipes` + `modifier_ingredients` got the same treatment keyed on `inventory.edit`. Three explicit `for insert/update/delete` policies rather than one `for all`, because a single `for all` write policy would have re-narrowed **reads** to menu.edit holders and blanked the till for every waiter. The four variant operations moved into `security definer` RPCs — `add_variant`, `update_variant`, `move_variant`, `delete_variant` — which the web actions now call instead of writing tables, so the renumbering logic exists once and the phone (which cannot call a Server Action) can reach it at all. **The trap this surfaced:** `item_variants.recipe_scale` is the *store keeper's* field, and the `inventory` role does not hold `menu.edit` — tightening the table would have broken stock counts silently. It gets `set_variant_recipe_scale`, gated on `inventory.edit` + owner/manager/inventory, and `updateVariantScale` now calls it. All six functions revoked from `public` **and** `anon` before granting to `authenticated` (the project's default privileges hand `anon` its own grant); `assert_may_edit_menu` is revoked from `authenticated` too, since only the definer functions call it. **Verified** by simulating both roles against real RLS in Postgres (`request.jwt.claims` + `set local role authenticated`), on a throwaway item deleted afterwards: a waiter reads 2 variants but their direct UPDATE changes 0 rows, their DELETE removes 0 rows, their INSERT is `42501`, and the RPC answers `42501 menu changes require a manager`; the owner's RPC update lands, `move_variant` returns the new position and returns the same position (no error) at the edge; a member switched to the tenant's **Inventory** role sets `recipe_scale` fine and still cannot rename a variant. Note for the next probe: flipping `user_tenants.role` alone proves nothing — `has_permission` reads `role_id` when it is set, and every seeded member has one. Advisors clean of ERRORs and the new RPCs are absent from the anon-executable list. `supabase/tests/menu_write_guards.sh` — **18 assertions, all passing** over real PostgREST as the roles that actually make these calls: the owner adds, renames, reprices, appends at the bottom, reorders and gets the same position back at the edge; the waiter is refused on all four RPCs (`42501`) and, more to the point, their **direct** PATCH changes 0 rows, their INSERT is refused and their DELETE removes nothing, on `item_variants` *and* `menu_items`; an anonymous call gets `permission denied`; a waiter still reads the menu; deleting a variant twice is not an error. Run against a **throwaway tenant and two throwaway users created for the run and deleted afterwards** — never the demo accounts. tsc + build clean.

- [x] **The phone can edit the menu** (2026-08-14). Mobile had no menu surface at all — every size, price and dish lived behind the web app, which is the wrong place to be when the owner is standing in the restaurant and a size is wrong. New `features/menu` module (Flutter): a searchable dish list quoting the buyable **price range** (a dish with sizes has no buyable base price), and a per-dish sizes screen with add / edit / move up / move down / remove. Deliberately narrower than the web editor — photo, add-ons, kitchen routing and availability stay there. Writes go through the RPCs above, never table writes, so both clients enforce one rule set; the drawer entry is gated on `menu.view` and the controls on `menu.edit`, so a viewer gets a read-only screen rather than a door that refuses everything. Delete confirms and names the real consequence (past orders stop showing which size was sold — a rename does not). 9 new tests (permission gating both ways, dead move buttons at both ends, the confirm dialog, the empty state, the sheet's Less→negative-delta arithmetic and its disabled save, and both variant-ordering fallbacks). Flutter suite green (265), `flutter analyze` clean. **On-device pass done** on an iOS simulator against the real backend (`integration_test/menu_edit_device_test.dart`): a real signed-in build walks drawer → Menu → dish → move down, then reads the till's own query (`PosRepository.menu()`) on the same session and gets the new order back; the reorder was confirmed in the database afterwards (`250 gm, 1 Jir, 1 Kg` → `1 Jir, 250 gm, 1 Kg`), so it is the RPC landing rather than a local rebuild.

- [x] **The bell took you off the screen you were on** (2026-08-15). Tapping the header bell navigated to `/notifications`, so a cashier mid-order glancing at "is that badge a new order?" lost the till. It now opens a **quick view** instead — the six most recent orders, each row a link to `/pos/{id}`, with **View all notifications** in the footer for the full page (which keeps history and the owner/manager activity tab). Desktop gets a popover, phones a bottom sheet via `useIsMobile` — a 352px popover anchored to a header icon is unreachable one-handed. New `components/ui/popover.tsx` (base-ui `Popover`, mirroring `dropdown-menu.tsx`'s positioner/popup split; width is a plain `w-*` here, no variant-prefixed base class to lose to, unlike `SheetContent`). Rows use `orderStatusLabel` / `orderTypeLabel` + `ORDER_STATUS_STYLE` rather than the `.replace("_"," ")` the old page did, and the unread marker is a dot that only *reinforces* the "Placed" badge and bold title — colour never carries it alone. Relative times come from new `lib/clock.ts` (`subscribeMinute` / `minuteNow`, the `useSyncExternalStore` pattern already used by reservations) + `relativeTime()` in `lib/format.ts`, which returns an absolute time on the server snapshot so nothing hydration-mismatches. **Trap paid for:** `react-hooks/set-state-in-effect` flags the initial `void refetch()` even folded into the subscription effect — routing it through the existing debounced `ping()` is what actually satisfies it, since the state then lands from a timer callback rather than the effect body. The realtime subscription, toast and 45s safety poll are unchanged; the count query is now issued alongside the preview fetch. **Verified** in the browser against the live tenant: the popover opens over `/pos` with six rows, correct labels, relative times and the footer link. tsc + eslint clean. **Not verified in a browser**: the mobile sheet path — `resize_window` did not take effect on this machine, so that branch rests on `useIsMobile` + `Sheet` behaving as they do elsewhere.

- [x] **There was no daily report anywhere — the orders list was the only view of a day** (2026-08-21). `/reports` cut a *range*; the POS Completed tab showed today's rows and a bare takings figure; nothing reconciled a day so it could be signed off. Three surfaces added, all reading one new `daily_report(uuid, date) -> jsonb` RPC so paper and screen can never disagree: a **day-close (Z) sheet** at `/reports/day?date=YYYY-MM-DD` (revenue breakdown, payment split, counts, cash reconciliation, top items, page-level CSV + browser print + **Print Z-report** to the thermal roll), a **day summary bar** on the POS Completed tab (takings, status counts, payment split, carried-over count), and a **By day** table on the Sales tab from `report_sales_by_day` (`20260821091000`). **The business day is now configurable**: new `tenant_settings.day_cutoff_minutes` (0–719, default 0) and `public.business_day(timestamptz, text, integer)`, with `tenant_day_start` rewritten to call it — *keeping its exact 2-arg signature*, so grants carry over and the three Flutter callers are untouched and get the cutoff for free. At cutoff 0 the new body is algebraically identical to the old one; **verified before and after against all three live tenants** (same timestamptz to the microsecond), which is the whole safety argument for touching a boundary the phone shares. Settings → General → **Day starts at** (Midnight … 6am), validated server-side against the same `DAY_CUTOFFS` list the Select renders. **The trap that shapes the payload:** revenue buckets on `bills.created_at` and payments on `payments.created_at`, so cash taken today against yesterday's bill lands in one and not the other and the two legitimately disagree — the RPC returns `revenue_cents`, `payments_total_cents` **and** `carried_cents` separately, and both the sheet and the printed slip state the gap in words rather than showing two totals that don't add up. Every money aggregate reads `bills` alone: `bills join orders` multiplies a merged bill by its order count (the fan-out `report_sales_by_bill` dodges with `distinct on`), and the summary bar dedupes payments by `bill_id` for the same reason. New `day_report` print doc — enum in its own migration (`20260821092000`) because an added enum value cannot be consumed in the same transaction, then `print_jobs.business_day` + a **sibling** `enqueue_day_report_job` (`20260821092100`) rather than touching `enqueue_print_job`, whose arity is frozen by its Flutter caller and whose permission map falls through to `settings.edit` — the wrong gate for a report. Routing falls back to the receipt/bill printer when nothing carries `day_report`, since nobody assigns a new document before their first close. Permission reuses `reports.view` (the sheet exposes strictly less than the Sales tab); `wantsDrawer: false` — a Z-report must not pop the till. **Verified** against the live DB as a real signed-in owner (`request.jwt.claims` + `set local role authenticated`, all writes rolled back): `sum(report_sales_by_day.revenue_cents)` ties exactly to `report_sales.revenue_cents` and the order counts tie too (the fan-out regression test); `daily_report.sales.revenue_cents` ties to `report_sales` over the same explicit bounds; `anon` gets `permission denied` on both new functions; a **waiter** on the same tenant gets `null` / zero rows and `42501 not authorized to print this` from the enqueue RPC; the enqueue path inserts a `day_report` job with the right `business_day` and printer. Advisors show one new WARN, the same `authenticated`-can-execute-a-definer class as the 119 existing ones and identical in shape to `enqueue_print_job`; nothing new is anon-executable. tsc + build clean; lint unchanged (8 pre-existing errors, none in touched files). **Known drift, not fixed:** Flutter's `printing_screen.dart` `_docLabels` map has no `day_report` key, so the phone's job list shows a fallback label — non-breaking, the drainer fetches rendered bytes from `/api/print/render`.
- [ ] **Flutter: `_docLabels` has no `day_report` entry** — `../extrahelper_flutter/lib/features/settings/printing_screen.dart` renders the raw enum string for day-close jobs in the phone's print queue. Enum values never reach staff. One-line map addition next time the Flutter app is touched.
- [ ] **Cashiers cannot see the day-close sheet** — it reuses `reports.view`, which is Owner/Manager-only, but a cashier is who actually closes a till in real life. Deliberately left as-is: a new `reports.daily` key would need seeding plus back-filling into every custom role. Role-design question for the owner, not a Daily Report one.

- [x] **Four defects in the daily-report change, found on a code review of it** (2026-08-21). (1) **The Z-report could not render on the machine that has the printer.** `job-render.ts` built the printed sheet by calling `daily_report`, which gates on `reports.view` — but the queue is drained by whichever staff member has the app open, or by the headless agent signed in as an ordinary user (`app/api/print/render/route.ts`: *"no service role anywhere"*). Every other document builder reads tables under plain tenant-membership RLS, so any member can render any job; this one could not. A manager queued the sheet, the cashier's till claimed it, `daily_report` returned null and the job failed. Split the gate from the arithmetic (`20260821093000`): `daily_report_build` holds the body and is revoked from **every** role including `authenticated`; `daily_report` keeps the `reports.view` gate; new `daily_report_for_print(_job_id)` takes tenant membership plus an existing `day_report` job instead. **The job's existence is the authorization** — only a `reports.view` holder can call `enqueue_day_report_job`, so the decision to expose those figures was already made by the time a row is in the queue. `daily_report` had to become `security definer` to call the build function (a security-invoker function runs as the caller, which has no grant); its gate still reads the caller, since `auth.uid()` is unaffected by SECURITY DEFINER. **Verified in one transaction**: the drainer has no `reports.view`, the old path returns null, the new path returns the correct revenue; `daily_report_build` is `42501` for a member; a non-member with the job id in hand (carried in a temp table so RLS could not mask the lookup, which had masked it and produced a misleading `P0002` on the first attempt) gets `42501 not a member of this restaurant`; a `bill` job passed to `daily_report_for_print` gets `42501 that job is not a day report`, so it cannot become a generic reader. (2) **The migration file did not reproduce the live database** — a stray `order by cs.closed_at` inside the `sess` CTE existed in `20260821091000` but not in what was applied. Behaviourally inert (the `jsonb_agg` carries its own `order by`), but a migration that replays into something else is the whole point of having one. File corrected, and parity now **proved rather than assumed**: `md5(regexp_replace(prosrc,...))` of every function compared against the same normalisation of the file's own text. (3) **`report_sales_by_day` returned nothing for a tenant with no `tenant_settings` row** — `cfg` was a plain select, so no config row meant no `series` rows and a silent empty report reading as "no sales". Now `coalesce(max(...))`, which yields one row even from an empty table; `daily_report` was already defensive this way, this half was not. (4) **The POS summary bar's `useMemo` never once hit** — it took the Completed tab's `isEarlier`, an inline arrow with a new identity every render. Takes the `dayStart` number instead.

- [x] **`tzDayStart` had a DST bug, and it predates the daily-report work** (2026-08-21). Found while checking that the TS day boundary agrees with the SQL one. The function probed the zone offset **at local noon** — so on a spring-forward day it read summer time while midnight was still winter time, and returned the start of the day an hour early. Live since the POS Completed tab shipped: one day a year, every DST tenant, the tab's day bound and `isEarlier` were an hour out. The new `businessDay` had a second, separate bug — it subtracted the cutoff from the **UTC instant** where `public.business_day` subtracts it from the **local wall clock**, which agrees on every ordinary day and diverges across a transition. Both now go through one `utcFromWall` whose rule is: sample the offset either side of the wall time, keep the candidates that read back as the wall time asked for, take the **latest**. That one rule resolves both awkward hours the way Postgres does — a doubled hour picks the second (standard-time) occurrence, and a skipped hour resolves forwards to the time the clock jumps to. **Three earlier attempts passed a 12-probe spot check and failed the sweep**, which is the point worth keeping: probing at local noon broke ordinary spring-forward days; a single pass broke later cutoffs; iterating to a fixed point broke the skipped hour; and a ±12h probe bracket broke **Chatham (+13:45)**, because a wall clock read as UTC sits up to 14 hours from the instant it names, so both probes landed the same side of the shift and the other offset was never generated at all. The reach is 26 hours: 14 for the offset, 12 to clear the shift. **Verified against Postgres over 89,928 probes** — twelve zones (Lord Howe's half-hour shift, Chatham's 12:45, southern-hemisphere Santiago and Asuncion, no-DST Kolkata, UTC) × six cutoffs (0/60/120/240/360/719) × every seven hours across a full year, compared bucket-by-bucket by md5 so a single differing row fails the check. Run against the **real compiled `lib/format.ts`**, not a transcription — an earlier harness inlined copies of the functions and cheerfully reported the old failures after the source was already fixed. tsc + build clean, lint unchanged (8 pre-existing errors, none in touched files). **Follow-up worth doing:** the sweep lives only in this session's scratchpad, and this function has now broken four times; it deserves a checked-in harness, but it needs both node and the database and the repo has no runner that spans the two.
- [ ] **`zonedTimeToUtc` has the same single-pass weakness** — `lib/format.ts`, used by reservations for `datetime-local` values. One probe, no round-trip check, so a booking taken for an ambiguous or skipped local hour resolves differently from `utcFromWall` right beside it. Not touched here because it would move existing reservation times; worth folding onto the shared helper deliberately, with the same parity sweep.

## Blocked — Open Questions (PRD §9)
- [!] Launch payment gateway(s): Stripe global vs regional e-wallet?
- [x] Printing approach: local agent vs cloud print service? — **Answered 2026-08-01: both, per tenant.** Jobs queue in Postgres (enqueue triggers on `kots` / `bills`); *Local* mode drains the queue from any open browser via QZ Tray (network + USB + system printers, and image mode for non-Latin scripts), *Cloud* mode drains it from a headless agent (`tools/print-agent`, network printers, no browser needed). Settings → Printers switches modes. See `docs/printing.md`.
- [!] Subscription tiers + feature-gating map?
- [!] Delivery model: own drivers vs 3rd-party couriers?
- [!] Future country tax compliance (Nepal IRD / India GST)?
