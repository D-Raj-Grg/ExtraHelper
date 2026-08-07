# TASKS — ExtraHelper

> Check this before starting work. Mark tasks done immediately (`[x]`). Add newly discovered tasks under the right milestone (or Backlog). Milestones map to `PLANNING.md` §6. Full spec: PRD.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (see Open Questions)

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
- [ ] **Repair the migration ledger** (see below). Do this first — it gates every other schema change.
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

- [ ] `brew install supabase/tap/supabase`, then `supabase link --project-ref ixrcdtwdcpsmlbocvejv`.
- [ ] `supabase migration list --linked` — confirm the 56/57 split from the CLI's own mouth.
- [ ] `supabase migration repair --status applied <version>` for each of the 56 repo-only versions.
      **This executes no SQL** — it only inserts the version into the ledger, teaching it what the
      database already knows. **`db push` must never be the command here.**
- [ ] `--status reverted` for the 57 MCP-stamped remote-only versions, so the ledger stops carrying
      two entries per migration.
- [ ] Re-run `migration list --linked` (expect a clean match), then `supabase gen types --linked` and
      diff against `lib/supabase/database.types.ts`. A diff there means the drift is worse than a
      ledger problem.

Until that passes, keep applying new migrations through the MCP exactly as today — **do not mix the
two paths mid-repair.**

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
- [x] **POS customer picker is no longer capped at 200** (2026-07-20). New `searchCustomers` server action (name/phone `ilike`, ≤20, LIKE-wildcard + or()-grammar sanitized) backs a type-ahead `CustomerPicker` (`components/pos/customer-picker.tsx`) that replaces the flat `Select` in `check-in-details.tsx`. Empty query shows the shipped recent-200; typing searches the full book. Keyboard/outside-click close, `role=combobox`, chip+clear when picked. tsc+lint+build clean.

## Blocked — Open Questions (PRD §9)
- [!] Launch payment gateway(s): Stripe global vs regional e-wallet?
- [x] Printing approach: local agent vs cloud print service? — **Answered 2026-08-01: both, per tenant.** Jobs queue in Postgres (enqueue triggers on `kots` / `bills`); *Local* mode drains the queue from any open browser via QZ Tray (network + USB + system printers, and image mode for non-Latin scripts), *Cloud* mode drains it from a headless agent (`tools/print-agent`, network printers, no browser needed). Settings → Printers switches modes. See `docs/printing.md`.
- [!] Subscription tiers + feature-gating map?
- [!] Delivery model: own drivers vs 3rd-party couriers?
- [!] Future country tax compliance (Nepal IRD / India GST)?
