# Changelog

All notable changes to the **ExtraHelper web app**.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are patch-level: each release is a batch of related work that shipped together, not a single commit. Dates are ship dates taken from git history. Each release ends with a collapsed **Technical** note listing the commits and the schema, RPC and migration substance behind it.

---

## [Unreleased]

Nothing yet.

---

## [1.0.13] — 2026-07-31

### Changed
- The dashboard now builds its numbers on the server, in your restaurant's timezone, so the same figures can be shown on the phone app.

### Fixed
- Blank Par level on an inventory item no longer crashes the save.

### Security
- Revenue, low stock and recent payments on the dashboard are now visible only to people whose role includes report access. Everyone else sees a clear "no access to reports" card instead.
- The sales report now checks report access before returning the headline revenue figure — it was the one report that never got the check.
- Stock adjustments, waste write-offs and stock-count entries are now permission-checked in the database and written to the audit log, so who moved stock is recorded.

### Added
- Barcode field on inventory items, unique per restaurant, so a scanner has something to match against.

<details><summary>Technical</summary>

`94817c0`, merge `047ef45`.

- New `dashboard_summary` RPC — tenant-timezone bucketing, gated on `reports.view`; ~90 lines of query + bucketing deleted from `app/(app)/page.tsx`. Bucketing moved to SQL because `package:intl` has no IANA timezone DB and Dart-side bucketing would fork the definition of "today".
- `report_sales`: added the `reports.view` guard, revoked `public`/`anon` EXECUTE (the original migration granted to `authenticated` and never revoked, so `public` held it by default).
- `adjust_inventory`: previously SECURITY INVOKER with *no* authorization at all. Now gated on `inventory.edit` and audited; tenant is read *before* the update so a SECURITY DEFINER `update … returning tenant_id` can't write another restaurant's row and ask afterwards.
- New `set_stock_count_actual` RPC replaces a direct `stock_count_items` write; audit row on count post; `inventory_items.barcode` (unique per tenant where set).
- Verified against the live dev project as an impersonated non-platform-admin owner: cross-tenant write refused, posted count refuses further edits, barcode uniqueness holds per tenant.
</details>

---

## [1.0.12] — 2026-07-27

### Changed
- Adding an item to an existing order now runs through one shared server-side pricing path, so the till and the kitchen ticket can no longer disagree on price.
- Adding an add-on to a live order now fails loudly if the dish is 86'd, instead of quietly dropping the line.

### Fixed
- A table can no longer be marked free while it still has a live order — that used to hide the order from the board while the kitchen was still cooking it.

### Security
- Marking an item 86'd and changing table state are now role-checked in the database. Those checks used to live in the app only, so any member could do either straight through the API.
- Both actions now write an audit log row; the raw column updates never did.

<details><summary>Technical</summary>

`552cfd3`, `36837ae`, `d11db23`.

- `amend_order_add_item` (`20260727090000`) is now the single implementation; `addItem()` is a ~15-line wrapper over it (was ~95). Fixes three defects by construction: two-round-trip non-atomicity between `order_items` and `order_item_modifiers`, a missing order-tenant check under SECURITY DEFINER, and duplicated modifier-link validation. Deliberate divergence: create *skips* an 86'd line (so a queued offline order isn't rejected wholesale), amend *raises*.
- `set_item_86` (owner/manager/kitchen) and `set_table_state` (owner/manager/receptionist/waiter/cashier) mirror the previous role sets exactly and audit; `set_table_state` refuses to free a table with a live order.
- Cent-parity verified across both order paths; negative cases each rejected for the right reason; EXECUTE granted to `authenticated` only.
- Flutter toolchain unblocked (Flutter 3.38.7, Xcode 26.2 + CocoaPods 1.17.0, Android SDK 36.1.0); bundle id fixed at `com.extrahelper.app`.
</details>

---

## [1.0.11] — 2026-07-26

### Added
- **Silent receipt and ticket printing.** Tickets now print straight to the station's printer through a local print agent instead of opening a browser tab per ticket. Printer registry in Settings → Printers (connection, paper width 58/80mm, role, default), station → printer routing on the menu Stations tab, and a print-job log with status and reprint.
- **Per-dish kitchen status.** A cook can mark one dish of a ticket ready instead of bumping the whole ticket; the ticket turns ready when every line is. Plus an all-day dish rail so the pass can batch.
- **Full-screen checkout.** Tips, extra charges (delivery and the like), round-off, line refunds and a live invoice preview beside the working area.
- Typed confirmation on every destructive owner action — retype the restaurant name (or the new owner's email for a transfer) before the button unlocks.
- A scheduled-deletion banner now shows on every staff page, with cancel for the owner. It used to be visible only inside the Settings danger tab.

### Fixed
- A discount applied after a tip no longer wipes the tip. A bill can reach zero but never go negative.
- POS tab counts and KDS status counts rendered blank (white text on a light pill) — fixed, along with six other status badges with the same latent bug.
- Fullscreen KDS hid its own dialogs and toasts; dialogs now appear over the fullscreen board.
- Tables now draw as a top-down glyph — surface plus one seat per cover, solid when seated, hollow when free — and look the same on the tables board and the destination picker. Selected chips carry a check icon rather than relying on colour alone.

<details><summary>Technical</summary>

`3c8567c`, `e352ddc`, `bf6c298`, `d784c9a`, `0d7f6c4`, `4095b97`, merge `bfe272a`.

- `lib/print`: ESC/POS encoder + KOT/bill/receipt templates + dispatch, behind an adapter. QZ Tray as local agent; `/api/qz/cert` + `/api/qz/sign` sign server-side so the private key never reaches the browser. New `printers` registry table and print-job log; `usePrint()`; `/kot/[kotId]` renders at the station printer's real paper width; browser print retained as fallback.
- `kot_item_status` migration: per-line status + timestamps, ticket status derived from its lines. `components/kds/ticket-card.tsx`, `dish-rail.tsx`; `KOT_STATUS_META` centralises label/icon/style/hint/action (every status pairs colour with an icon — grayscale-safe).
- `checkout_extras` migration: `bills.tip_cents` / `rounding_cents` / `note` + `bill_charges` table. Hand-rolled totals in `apply_bill_discount` / `apply_coupon` collapsed onto `recompute_bill` as the single source of truth. `amountInWords()` in `lib/format`, SSR-stable, uses the tenant's currency code.
- Danger-zone actions routed through one `ConfirmPhraseDialog`; `getActiveTenant` now carries `deletion_scheduled_at`.
- Badge fix: overrides that set `bg-muted`/`bg-background` without a matching foreground. Fullscreen fix: fullscreen the document element (portals render to `document.body`) + local-state z-40 overlay.
- `pnpm-lock.yaml` synced with the `qz-tray` dependency — a clean `pnpm install --frozen-lockfile` would have failed.
</details>

---

## [1.0.10] — 2026-07-20

### Added
- **Recipe editor.** Every ingredient for a dish in one panel with units, live plate cost and food-cost %, replacing the one-ingredient-per-submit form. A coverage view flags dishes that sell but deduct nothing, and add-ons can carry their own ingredients.
- **Purchasing from low stock.** One click drafts a purchase order per supplier for everything below reorder level, ordered up to par, skipping items already on an open PO.
- Waste quick-log and per-item usage history.
- Menu food-cost report.
- **Owner-only Dangerous Area** in Settings: selective reset by domain (or reset everything), ownership transfer to an active member, and delete-with-7-day-grace that can be cancelled. Resource-usage card shows counts against plan limits.
- Breadcrumb header on deep pages, linking back to the section list.
- Customer picker on POS is now type-ahead search — it used to cap out at 200 customers.
- Veg marker now reaches guests on the QR menu and the online storefront.

### Fixed
- Stock deduction now accounts for variants (a Half portion deducts half) and add-on ingredients, aggregated to one movement per ingredient.
- Voiding a line restores exactly what the sale took, even if the recipe changed since — it reverses the recorded movements rather than recomputing.
- Recalling a ticket no longer deducts stock a second time.
- An add-on can no longer be priced onto a dish it isn't linked to ("extra cheese" on a beer); the whole line is rejected rather than the stray add-on silently dropped.
- Redeeming points by phone no longer reassigns a bill that already has a customer.
- Blank Par level stored 0 instead of crashing.

### Security
- Off-menu custom-priced lines are now audited on both the create and amend paths.

<details><summary>Technical</summary>

`5aa069d`, `02888f7`, `473827d`, `b28d4f2`.

- `20260720120000_dangerous_area.sql`: `tenants.deletion_scheduled_at`, extended plan-limit jsonb, owner-only SECURITY DEFINER RPCs `reset_tenant` / `transfer_tenant_ownership` / `request_tenant_deletion` / `cancel_tenant_deletion`, cron-only `purge_scheduled_tenants` (daily pg_cron). Each re-checks `has_tenant_role(_tenant,'owner')`; execute revoked from public/anon.
- `item_variants.recipe_scale` + `modifier_ingredients` mini-BOM; `trg_deduct_stock` deducts base recipe × variant scale + modifier BOM; deduct-once-ever guard; `block_negative_stock` extended to the scaled path. `void_order_item` negates recorded sale movements (drift-proof).
- `report_dish_food_cost` RPC; `create_draft_po_from_reorder` + `inventory_items.supplier_id`; `par_level` NOT NULL.
- Modifier↔item link validated in both `addItem` and `place_staff_order`; `searchCustomers` server action + `CustomerPicker`; `qr_menu` / `storefront_menu` emit `is_veg`.
- Verified in rolled-back DB tests: deduct/void parity to the unit for base, variant, modifier and shared-ingredient cases.
</details>

---

## [1.0.9] — 2026-07-18

### Added
- **POS is now one screen** with three tabs — Orders, Table, KOT — so a cashier works the floor without leaving the page. The tab is in the URL, so refresh and deep links land where you left off.
- KOT tab for the cashier: status dropdown, print with a printed badge, Completed and Split-by-type toggles, live updates.
- Quick actions on an order card — big total, Add, Print slip, Checkout, and a menu with Pin/Unpin and Clear order. Pinned orders sort first.
- **Confirm & fire** places and fires an order in one tap; **Confirm only** holds it for coursing.
- Veg / non-veg marker on menu items — unmarked stays a real, distinct state.

### Changed
- Cancelling from the KOT tab is a proper audited line void: reason required, manager-gated, stock restored, and it's blocked once the order is billed.

<details><summary>Technical</summary>

`acb0751`, `6d4b1e7`, `7ae50ff`.

- Tab state URL-synced via `history.replaceState` (no server round-trip per tap); shared `KOT_CARD_SELECT`, `loadPosData` pulls kots, `table_id` on order cards, shared `orderTypeLabel`, `bumpKot` revalidates `/pos`; KOT tab has its own Realtime channel.
- `menu_items.is_veg` (nullable), POS order-flow + `list_order_staff` migrations, regenerated `database.types.ts`.
- `cancel_order` RPC (manager-gated, voids lines → restores stock, audited) + `orders.pinned_at`; new actions `cancelOrder`, `pinOrder`, `listOrderKotIds`; `lib/format` helpers.
</details>

---

## [1.0.8] — 2026-07-14 → 2026-07-15

### Added
- Restaurant name is now editable in Settings (owner only) — it used to be set once at onboarding with no way to change it.
- Menu and Inventory rebuilt as tabbed, card-based screens: Menu (Items · Categories · Add-ons · Combos · Stations) with search and filters, Inventory (Stock · Recipes · Stock counts) with clickable stat cards and inline quick-adjust. Jargon like par, UoM, BOM, oversold and variance is explained inline.
- POS goes photo-first: dish tiles show the photo (with an initials placeholder when there's none), a count badge when the dish is in the order, menu search, and one-tap destination chips.
- The design system is now written down (`.impeccable.md` + CLAUDE.md rules): bold high-contrast for staff mid-service, WCAG AA, keyboard, reduced motion, and the shared colour vocabulary.

### Changed
- New theme (base-nova / mauve) across the whole app.
- Admin screens — Settings, Reports, Cash, Tables, Team — restructured to one consistent frame with labelled fields, tabular figures on money and semantic colour tokens.
- Refunds now confirm with the amount and a reason instead of firing on one click of a small red button.
- Kitchen ticket age is stated in minutes with an icon, not communicated by border colour alone (which a colourblind cook couldn't read).
- Raw status words like `in_kitchen`, `preparing` and `open` no longer reach staff — they show as proper labels.

### Fixed
- Two restaurants with the same name were indistinguishable in the switcher; each entry now shows its unique @slug.
- Every slide-over panel in the app rendered at a fixed narrow width regardless of what it asked for.
- Dropdowns keyed by id showed raw UUIDs and internal values ("sandbox" instead of "Sandbox (test)").
- Menu-item photo and logo uploads were rejected by the framework before they ran, with no error shown.
- Edits inside the item editor — variants, add-ons, station routes, availability — appeared to do nothing until you closed and reopened the panel. They had saved; only the view was stuck.
- On the tables board, a colleague touching any table wiped your in-progress split selection.
- A rejected table delete left the row on screen with no explanation.
- Cash variance painted short and over the same red; now Balanced / Short / Over with signs, and shift reports name the cashier.
- Team: destructive actions (delete role, remove member, cancel invite) were unconfirmed one-click; add-member defaulted to whatever role sorted first and said "Saved." whether it attached an account or parked an invite.
- Generating a bill failed silently and looked like a broken button.

<details><summary>Technical</summary>

`7942ac5`, `d4ca04c`, `72cb1c9`, `58a02b3`, `d589bb1`, `8cd2a01`, `3d9f23f`, `904dc6c`, `01e7b38`.

- Sheet width became a `size` prop (sm|md|lg|xl|half) — the hardcoded `data-[side=right]:sm:max-w-sm` survived tailwind-merge and beat call-site widths on specificity. base-ui `Select` wrapper derives its `items` map from `SelectItem` children. Server Action body limit raised to 6mb (default 1MB < the 5MB/3MB upload validation).
- `menu-manager` (1,133 lines) split into `components/menu/`; `inventory-manager` into `components/inventory/`; five monolithic admin components split into per-surface directories.
- Item editor holds the open item by **id**, derived from the live list, so revalidation flows through.
- `TableActionsPanel` / `DraggableTable` hoisted to module scope — defined inside their parent, every render created a new component type and remounted the subtree.
- shadcn primitives regenerated under base-nova/mauve; `tzOffsetMs` exported and deduplicated; alert-dialog + textarea primitives added; Suspense per reports tab.
- Order/KDS labels and tones moved to `lib/order-constants.ts` and `lib/kds-constants.ts`.
</details>

---

## [1.0.7] — 2026-07-13

### Added
- **User profiles** — display name, unique @handle and avatar, shown in the sidebar and account menu.
- **Get Started flow**: choose to create a new restaurant or join an existing one, with the profile step folded in.
- Run more than one restaurant from one account — "+ Add restaurant" in the switcher.
- **Join codes**: the Team page generates a code a new staff member can redeem; redeeming creates a pending membership an owner approves, so a leaked code grants nothing on its own.

### Security
- A logged-in user could read every other user's name, @handle and avatar. Profile reads are now limited to yourself, people who share a restaurant with you, and platform admins.

### Fixed
- Saving a profile when the profile row was missing reported "Saved" while changing nothing.
- A handle collision during signup could leave an account with no profile row at all.

<details><summary>Technical</summary>

`5d467dc`, `8061879`, `d195548`, `a2d1154`, `89b2d32`, `5da417b`.

- `profiles` table (RLS self-write) + `avatars` Storage bucket + `handle_new_user` trigger that never fails the auth transaction; existing users backfilled. `initialsFor` in a client-safe `lib/initials`.
- `provision_tenant` gains `_force_new`; `/onboarding?add=1` reachable for onboarded users; switcher renders with a single membership.
- `tenant_join_codes` + `create_join_code` / `redeem_join_code` (redeem = pending); `claim_invites` also runs on the OAuth/magic-link callback.
- `profiles_read` no longer `using(true)`; `updateProfile`/`uploadAvatar` upsert; `handle_new_user` execute locked to trigger-only per advisor.
- Advisor hygiene: scalar `auth.uid()` subselect in RLS, self-write split into insert/update/delete (removes multiple-permissive-policies on SELECT), index on `tenant_join_codes.role_id`.
</details>

---

## [1.0.6] — 2026-07-13

### Added
- **Drag-and-drop floor map** — arrange tables to match the real room; positions persist.
- Transfer an order to another table, merge two tables onto one bill, or split selected items to a new order.
- **Customers can pay themselves**: QR pay-at-table and prepay from the online storefront, with the gateway result reconciled back by webhook.
- Per-restaurant payment gateway in Settings (was hardcoded to sandbox), logo upload for receipts, and multi-branch management.
- Onboarding gains an optional tax-rules and service-charge step.
- Inventory: item category and par level, staff-meal and transfer movement types, partial goods receipt against a PO, and purchase-cost history per item.

### Fixed
- Uploading a logo and then saving Settings wiped the logo.
- Asking for a payment quote used to flip the order to "billed" and the table to "bill requested" — quoting is now read-only.

### Security
- Internal database helpers were callable by anonymous users: Postgres grants EXECUTE to PUBLIC by default, so revoking from `anon` alone left them open. Grants locked down and verified.

<details><summary>Technical</summary>

`16ac673`, `fe8ef39`, `7ce7ff8`, `4c3df0c`, `7b75719`, `db7e850`, `c166cbb`.

- dnd-kit floor map persisting `pos_x`/`pos_y`; `transfer_order` + `split_order_items` RPCs; merge composes `create_bill` + `add_order_to_bill`; `refresh_table_state`; audit actions `table_transfer` / `table_split`.
- `receive_po_partial` RPC (partial vs received); `stock_movements.unit_cost_cents` → price-history view; `tenant_settings.payment_gateway`.
- `public_bill_quote` + `public_pay_order` (anon, token/order-scoped, credit-only, overpay-clamped) over a shared `_build_bill_for_order`; `/api/webhooks/[gateway]` reconciles pending → completed/failed with the service-role key (first service-role use; secret-guarded, server-only); `public_record_pending` persists the row the webhook reconciles.
- Grants verified via `has_function_privilege` plus a create → quote → pay → idempotent-repay → cleanup smoke test.
</details>

---

## [1.0.5] — 2026-07-13

### Added
- **Menu depth**: item variants, a shared add-on library linked per item, combo builder, item photos, per-item availability schedules, and inline editing.
- Multi-station routing per item; stations can be renamed and deleted.
- **POS line depth**: variant and add-on pricing folded into the line, quantity steppers, notes, course and seat, per-line hold (held lines don't fire), and manager void.
- Order status now follows the kitchen automatically as tickets are bumped, with a Served step.
- **86 propagation**: the kitchen can mark a dish sold-out from the KDS board and it greys out on POS instantly.
- Sign in with a one-time email code or with Google.
- **One bill across several orders** — merge another fired order onto an open bill — plus a split-across-methods tender builder (cash + card + online on one bill).

### Changed
- Every table, checkbox, dropdown and button in the app normalised onto the shared component library — same look and keyboard behaviour everywhere.

<details><summary>Technical</summary>

`434298d`, `ce6ef22`, `7a588ba`, `d339661`, `814145e`, `be18e88`, `c17751c`, `bc4e1e9`.

- Waves 1–4 of the shadcn consistency pass: 13 table surfaces, checkboxes (form parity via `name` + `value='on'`), 12 files of selects (base-ui treats `value=""` as the empty state), 16 files of bespoke buttons with intent-matched variants. tsc + build clean, no behaviour change.
- New `menu-images` bucket + RLS, `item_availability` table, `order_items.is_held` (`fire_order` skips held), `order_item_modifiers`, `ORDER_FLOW`, `sync_order_status_from_kots`, `mark_order_served`, `create_bill_for_order` guards against draft/cancelled, `order_items` + `menu_items` added to the realtime publication.
- `add_order_to_bill` RPC (`recompute_bill` already aggregates linked orders); by-method tenders use deterministic idempotency keys.
- `sendEmailOtp` / `verifyEmailOtp` + `signInWithGoogle` through the existing `/auth/confirm` callback.
- MCP-applied migrations persisted as local files for waves A/C/D/E/G.
</details>

---

## [1.0.4] — 2026-07-13

### Added
- **Pay with loyalty points** at the till — capped by both the balance and what's still owed, with a configurable point value.
- Per-line discounts (manager) and **coupon codes** any cashier can apply, validated for expiry and usage limit.
- **Stock counts**: snapshot on-hand, enter counted quantities, see the variance live, then post to reconcile stock and log the movement.

### Fixed
- Item and coupon discounts used to be silently dropped when a bill recalculated; discount maths is now one shared function used by every path.

### Security
- Defence-in-depth sweep: every direct database query now names the active restaurant, so a user who belongs to several can't mix rows.
- Signup errors now say what's actually wrong (rejected domain, already registered, weak password) instead of showing raw provider text.
- Two people redeeming points or applying the same coupon at the same moment can no longer double-burn points, overpay the bill or bypass a coupon's usage limit.

<details><summary>Technical</summary>

`2d1e5d7`, `a2ea3a5`, `a4ee066`, `90b260c`, `6511830`, `6a07e8e`.

- `redeem_points_for_bill` (burn + `points` payment atomically, idempotent, gated on `payment.take`) + `attach_bill_customer` + `tenant_settings.points_value_cents` (`20260713090000`).
- `bill_discount_total()` unifies bill-level vs item-level discounts for both `apply_bill_discount` and `recompute_bill`; `apply_item_discount` (owner/manager, audited); `coupons` table + `apply_coupon` (`20260713100000`).
- `start_stock_count` / `post_stock_count` with a `posted_at` double-post guard (`20260713110000`).
- Concurrency pass (`20260713120000`): `FOR UPDATE` on bill + loyalty row, clamp to outstanding due, refuse to overwrite an order's existing customer, atomic bump-if-under-max on `used_count`, reject >100% coupons.
- `.eq("tenant_id", …)` added across menu, tables, POS and cash queries; `EMAIL_RE` + `friendlyAuthError` on signup.
</details>

---

## [1.0.3] — 2026-07-12

### Added
- **Full reporting suite** — Sales, Inventory, Staff and Customers tabs sharing one date window, with sales broken down by category, order type, hour, table and branch, plus voids, refunds and table turnover. CSV export on every table and print-to-PDF.
- Orders now record which staff member took them, so staff reports show sales, orders, tips and shift hours per person.
- **KDS station filter** — a kitchen screen remembers its own station across reboots — with all-day dish counts and recall of a ticket bumped too early.
- **Thermal KOT printing**: an 80mm ticket per station, printed automatically on fire and reprintable from the KDS board.
- **Split the bill** three ways: equal N-way, by item, or an arbitrary amount, each recorded as its own payment against the one bill.

### Fixed
- Reservation times entered on the reservations page and the public booking page were stored in the wrong timezone — 7PM could show as 12:45AM.
- Revenue and customer spend were inflated when one bill covered several orders.
- Redeemed points showed as a negative number in reports; cancelled orders are now excluded.
- Re-firing an order no longer reprints tickets that already printed.
- Splitting a bill could overpay it, and a double-click on a share could charge twice. The overpay clamp is in the payment routine itself, so it covers every payment path, not just splits.
- By-item splits left a bill a cent or two short and the order never closed; there's now a "Pay remaining" action.

### Security
- CSV exports neutralise spreadsheet formula injection.
- Every report routine now checks report permission, so the data can't be pulled by calling the API directly.

<details><summary>Technical</summary>

`880c908`, `8d59ce0`, `4ced1fb`, `93a57a7`, `d99f27d`, `05ef6fd`, `0637d6f`, `7c8efb5`.

- `20260712110000`: `report_inventory`, `report_staff` (DEFINER, owner/manager), `report_customers`, `report_sales_by_bill`, `report_sales_by_category`, `report_extras`; `orders.waiter_id` recorded by POS and `place_staff_order`. `lib/csv` + `ExportButtons`.
- `20260712120000`: `distinct on (b.id)` kills bill fan-out double-count (by-type revenue now equals the headline), `abs()` on `points_redeemed`, `reports.view` guard on every report RPC, cancelled orders excluded.
- `zonedTimeToUtc(wall, tz)` via Intl offset applied on the *input* side of both reservation actions; `storefront_menu` now returns timezone.
- `app/kot/[kotId]` with `@page` sizing, auto `window.print()`, `markKotPrinted`; `fireOrder` returns new KOT ids and re-queries scoped to `printed_at IS NULL`.
- `components/bill-split.tsx` computes shares client-side, schema-free (survives `recompute_bill`); `20260712140000` clamps `record_payment` to `least(amount, total - paid_before)` and no-ops a settled bill; deterministic per-share idempotency keys + synchronous in-flight ref.
</details>

---

## [1.0.2] — 2026-07-12

### Added
- **Notification bell** in the header with a live count of orders waiting to be acknowledged, plus a `/notifications` screen with an Orders tab and an Activity feed (managers and owners only).
- **Custom roles and permissions**: a 35-key permission catalogue, seven seeded default roles per restaurant, and a Team screen where you build your own roles with a grouped permission matrix and manage staff — add by email, approve pending members, change role, remove, cancel invite.
- Sidebar navigation is now grouped and each item is shown only to roles that can use it.

### Security
- Money operations (void, discount, refund, take payment) are permission-checked inside the database, so a custom role that denies an operation blocks it even when called directly through the API — not just hidden in the UI.
- Members whose join is still pending get no access until an owner approves them.

<details><summary>Technical</summary>

`115f180`, `3c71d35`, `589cba5`, `99642b2`, `f56184b`, `386c9ef`, `dbe503d`.

- `20260712090000`: `permissions` catalogue + per-tenant `roles` + `role_permissions` + `staff_invites`; `user_tenants.role_id` + `status`. `20260712091000`: `default_role_permissions` mirrors the old `requireRole` map, `seed_system_roles`, backfill, `provision_tenant` seeds new tenants. `20260712092000`: `has_permission` / `get_my_permissions` / `list_tenant_members` / `add_member_by_email` / `set_member_role` / `approve_member` / `remove_member` / `cancel_invite` / `claim_invites`, with last-owner guards.
- App layer: `requirePermission` + `getMyPermissions`, `PermissionProvider` + `useHasPermission`; all 17 staff pages swapped from `requireRole` to `requirePermission('<key>.view')`. Existing `app_role` RLS left unchanged as the security floor.
- `20260712100000` gates `void_order_item` / `apply_bill_discount` / `refund_payment` / `record_payment` on `has_permission`.
- `audit_logs` added to the realtime publication (`20260712080000`); bell hidden for roles that can't open `/notifications`; shared `ACTION_STYLES` in `lib/audit-constants.ts`.
</details>

---

## [1.0.1] — 2026-07-12

### Added
- **Live updates everywhere.** POS, tables and the kitchen display refresh themselves as colleagues work — no manual reload.
- **Optimistic actions**: adding a line, changing a table's state or bumping a ticket lands instantly, with a toast and rollback if the server refuses.
- **Works offline.** Orders and payments taken while the connection is down are queued on the device and replayed on reconnect without duplicating, with a header badge showing offline state and how many items are waiting. Menu and tables are cached so a warm tab can keep taking orders.
- Quick Order composer on POS — build a whole order, online or offline, in one panel.
- Installable as an app (PWA) with real icons and an offline page.
- Reports gain a custom date range and paged top-items; the dashboard gains 7/14/30/90-day windows.
- **Audited super-admin impersonation** — view a restaurant as its owner, with an amber banner and an exit button while active; every start and stop is logged.
- Automatic dunning: subscriptions past their period end move to past due, then suspend after seven days. Runs nightly, with a manual "run now" for platform admins.
- Optional per-restaurant hard block on selling below zero stock.

### Fixed
- Live updates arrived but were filtered out before reaching the browser, so screens only changed on manual refresh — the socket was never carrying the signed-in user's identity.
- Installing the app and registering the service worker were blocked by the login redirect.
- On flaky Wi-Fi, valid queued orders could be dropped; network failures no longer count against the retry limit, and a retried request reuses the same key instead of creating a second order or charging twice.

### Security
- The service worker cached signed-in pages, so on a shared tablet one user's screen could be served to the next. Authenticated pages are never cached now.
- Placing an order rejects a table that isn't yours.

<details><summary>Technical</summary>

`dc07adb`, `a0aa3bc`, `a99a7b5`, `4b2e2a9`, `8b25a30`, `3cc2e12`, `e899a53`, `0bfd3e3`, `e7a1910`, `8802260`, `c6387f3`, `23b98ba`, `c3d0750`, `8926ac4`, `b620b59`.

- Realtime root cause: `postgres_changes` on RLS tables only delivers when the socket carries the user JWT. Module-singleton browser client + `components/realtime-auth.tsx` (`setAuth` on mount, re-auth on token refresh). Per-event `router.refresh` replaced with live client state / debounced scoped refetch. `20260712010000` adds `restaurant_tables` to the publication.
- `place_staff_order` RPC with client idempotency key, deduped on `orders unique(tenant_id, idempotency_key)` (`20260712020000`); `takePayment` accepts a client key; `lib/offline/queue.ts` on localforage/IndexedDB; `OfflineSyncProvider`; `lib/offline/menu-cache.ts`; retry cap with reject-vs-retry classification; `20260712070000` rejects a foreign `table_id` and scopes the occupy update by tenant.
- `20260712030000` `report_top_items` `_limit`/`_offset`; reports range math moved to tenant tz.
- `20260712040000` `audit_logs_insert` gains an `is_platform_admin()` escape; impersonate-tenant cookie honoured only for platform admins, 4h expiry, audited.
- `20260712050000` `run_dunning()` on pg_cron daily 03:00 UTC + `trigger_dunning()`; `20260712060000` `tenant_settings.block_negative_stock` enforced in `trg_deduct_stock`.
- SW cache bumped `eh-v3`, static `/offline.html` fallback; PWA files added to `PUBLIC_EXACT` in the proxy.
</details>

---

## [1.0.0] — 2026-07-11

First working release: the whole restaurant platform, from taking an order to closing the day.

### Added
- **Foundation** — multi-restaurant from the start, with every table protected so one restaurant can never see another's data. Email/password sign-in, guided onboarding, role-based access, audit log, and a platform-admin area.
- **Service** — menu management, floors and tables, web POS, kitchen tickets fired per station, and a kitchen display that updates live.
- **Billing** — tax, service charge and discounts computed on the server, audited voids and refunds, payments, cash day-close, and printable and digital receipts.
- **Inventory** — recipes that deduct ingredients automatically on sale, low-stock alerts, suppliers, purchase orders and goods receipt. Voiding an item puts the ingredients back.
- **Reporting** — server-side aggregates, time windows, previous-period comparison, KPI dashboard and multi-branch rollup.
- **Customer channels** — QR dine-in ordering, reservations with a public booking page, an online storefront, delivery tracking, loyalty and feedback.
- **Monetisation** — plans and subscriptions, feature gating, invoices, and a pluggable payment gateway.
- **Live dashboard** on the home page: revenue today with a day-on-day change, paid orders and average, active orders and open tickets, low-stock count, a 14-day revenue chart, and lists of low stock, upcoming reservations and recent payments.
- Shared app shell with a consistent header and sidebar; per-user appearance preferences (dark mode and five text sizes) that follow you across devices with no flash on load.
- Fullscreen kitchen display, printable table QR codes, and a restaurant switcher for people who belong to more than one.
- Tax rules and receipt template (header, footer, terms) editable in Settings.
- Sign-up now says "check your email", with a resend button.
- Oversold items are flagged in red, separately from amber low stock.

### Fixed
- Selling the same ingredient from two tills at once could lose a deduction; stock now moves atomically.
- QR ordering is rate-limited and capped per line and per order.

<details><summary>Technical</summary>

`2daa9e3`, `f199a55`, `f67ed1e`, `d67736a`, `5ef85e4`, `cbaa34d`, `76839df`, `7e79edf`, `e8c5267`.

- Next.js 16 + Supabase. 45-table schema, RLS on every table (membership-based isolation), 26 migrations; milestones M0–M7 (foundation, core ops, billing, inventory, reporting, customer channels, monetisation, hardening). Home moved from `/dashboard` to `/` (auth-gated).
- `app/(app)/` route group with a shared shell (auth resolved once); `PageShell` + `PageHeader` across 16 pages; `user_preferences` table (theme + text scale, own-row RLS) mirrored to httpOnly cookies so the root layout SSR-paints with no flash.
- Dashboard is a server component, tenant-scoped, tz-aware daily buckets via Intl, recharts + shadcn `ChartContainer`.
- `20260711040000_void_restores_stock` (restore-once via a `void:<id>` tag), `_040100_adjust_inventory_atomic` (`adjust_inventory()` kills the read-modify-write race), `_040200_qr_order_limits` (20/line, 40/order, 3 orders per table per 30s), `20260711050000_realtime_kds` (publication + replica identity full; 8s poll replaced by realtime with a 30s safety poll).
- Non-negotiables honoured throughout: tenant isolation, region-configurable pricing, idempotency keys, audit trail, pluggable adapters.
</details>

---

[Unreleased]: #unreleased
