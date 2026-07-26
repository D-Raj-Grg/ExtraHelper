@AGENTS.md

# ExtraHelper — Restaurant Management SaaS

Multi-tenant SaaS for restaurants: table ordering, KOT, billing, inventory, reports, customer channels (QR/online/reservations/loyalty), monetized by per-tenant subscription. Full product spec lives in the PRD — read it before non-trivial work: `/Users/almighty/.claude/plans/1-help-me-to-wondrous-bird.md`.

## Stack
- **Web:** Next.js (App Router) — admin, POS/cashier, KDS, super-admin console, public storefront + QR pages. ⚠️ This Next.js has breaking changes vs training data — see `@AGENTS.md`, read `node_modules/next/dist/docs/` before writing Next code.
- **Backend/data:** Supabase — Postgres, Auth, Realtime, Storage, Edge Functions, **RLS** for tenant isolation.
- **Mobile:** Flutter (iOS + Android) — waiter, manager, inventory, owner dashboard. Supabase Flutter SDK.
- **Package manager / dev:** `npm run dev` for web.

## Non-negotiable rules
1. **Tenant isolation is sacred.** Every business table has `tenant_id` (and `branch_id` where relevant). Access enforced by **Supabase RLS keyed on JWT `tenant_id` + `role`** — never trust client-side role alone. Any new table = add RLS policy in the same change. Never expose the service role key to any client.
2. **Region is configurable, not hardcoded.** Currency, tax rate(s) (inclusive/exclusive, multiple), service charge, receipt template, order-type fees all live in per-tenant settings. Do not hardcode a country's tax/currency/invoice format.
3. **Realtime + optimistic UI** for POS/KDS surfaces (KDS tickets, table states, KOT firing, 86 items, order status) via Supabase Realtime, channels scoped by tenant/branch/station. Target < 200ms perceived.
4. **Offline resilience** for waiter/cashier: queue orders + payments locally, sync on reconnect. Use **idempotency keys** on orders/payments; resolve conflicts by server timestamp.
5. **Audit everything sensitive:** voids, discounts, refunds, price changes, super-admin impersonation → `audit_logs` with actor + timestamp.
6. **Integrations behind adapters:** payment gateways (Stripe / eSewa / Khalti / …), printing (ESC/POS via local agent or cloud print), notifications (email/SMS). Keep them pluggable + configurable per tenant — no gateway/printer hardcoded into business logic.

## Roles (per-tenant RBAC)
Super Admin (platform, us) · Owner/Admin · Manager · Receptionist/Host · Cashier · Waiter · Kitchen/KDS · Inventory/Store Keeper · Customer. Surfaces + permissions per role in PRD §1.

## Order lifecycle
`draft → placed → in_kitchen → preparing → ready → served → billed → closed`. KOT items route per **kitchen station** (grill/bar/tandoor/dessert); each station gets its own ticket → thermal print + KDS. Post-fire changes = KOT amendments (voids need reason + approval).

## Inventory rule
Menu item → recipe/BOM → selling a dish **auto-deducts** ingredient stock (theoretical usage). Stock-in via PO → GRN. Low-stock/reorder alerts suggest reorder qty.

## Reporting windows
Every report supports **today / daily / weekly / monthly / yearly / all-time** + custom range + prev-period comparison. Aggregate server-side.

## Data model
See PRD §4 for the full table list. Core groups: tenancy/subscription · users/audit · floors/tables/reservations · menu/modifiers/stations · orders/KOT · bills/payments/tax/cash-sessions · inventory/PO/suppliers · customers/loyalty · online-orders/delivery.

## Build order (phased — ship value early)
0 Foundation (Supabase schema + RLS, auth/roles, app shells, onboarding, super-admin skeleton) →
1 Core ops (menu, tables, waiter ordering, KOT + stations, KDS, thermal print) →
2 Billing/POS (bills, tax/discounts, split/partial, payments, day-close) →
3 Inventory (BOM auto-deduct, PO/GRN, counts, alerts) →
4 Reporting →
5 Customer channels (QR dine-in, reservations, online order/delivery, loyalty) →
6 Payments + SaaS monetization (gateway, subscription billing, feature gating) →
7 Hardening (offline sync, multi-branch rollups, perf, localization).

## Design system (read `@.impeccable.md` for the why)

Staff use this mid-service, on a phone tableside **and** at a counter — both matter equally. Bold, high-contrast, legible at arm's length. The bar is **WCAG AA + full keyboard + `prefers-reduced-motion`**. Match these patterns; don't invent a second way to do the same thing.

**Page frame.** `PageShell` (default `standard` width — never `narrow`; it was 512px and cramped every table) + `PageHeader`. Title is the surface (`"Settings"`, `"POS"`), the restaurant name goes in the description — never `{tenant.name} · X` as the title.

**Components.** shadcn/base-ui only. `Card` over hand-rolled `rounded-lg border`; `Badge` over hand-rolled pills; `Table` + `TableHeader` for any tabular data (**every column gets a header**); `Field`/`FieldLabel` (`htmlFor`) for every input — a `<label>` wrapped round a `Select` associates nothing. Icons: lucide only, never text glyphs (`✕`, `▲`).

**Tap targets ≥44px.** Quantity steppers, chips, and anything a waiter hits mid-rush. `size="icon-sm"` is for desk-only admin surfaces.

**Money & numbers.** `tabular-nums` on every figure in a column; right-align numeric columns. Format via `money()` / `moneyRange()` / `lib/format` — never hand-rolled `toFixed`. Currency, timezone, tax and fees come from tenant settings. **Quote a price someone can actually pay**: a dish with variants forces a choice, so its base price is unbuyable — POS tiles show `itemPriceRange()` (`components/pos/cart-types.ts`), in the `aria-label` too.

**Semantic colour, app-wide.** `emerald` = good/balanced/free · `amber` = warning/low/occupied/over · `destructive` = error/short/loss · `blue` = reserved/info · `orange` = bill requested. Tokens only — no raw `green-500`/`red-600`. **Never colour alone**: pair with an icon, label, or sign (`+`/`−`). Red-vs-green is the worst offender — it's the most common colourblindness. `VegMark` (`components/pos/veg-mark.tsx`) is the pattern: **circle vs triangle** carries the meaning, colour only reinforces. If it fails a `grayscale(1)` screenshot, it's wrong.

**A flag nobody has set is not `false`.** `menu_items.is_veg` is nullable on purpose — `not null default false` would have labelled every existing dish non-vegetarian. Where "unknown" is a real state, model it, render nothing for it, and use a Select (a checkbox can't say "unmarked").

**Choosing.** Few options a waiter picks mid-service → **chips** (`components/pos/choice-chip.tsx`), built on native radios/checkboxes so arrow keys and screen readers work. Long or admin-only lists → `Select`. Picking a dish → **photo-first tile** (`components/pos/menu-tile.tsx`): image leads, name + price under, monogram placeholder when there's no photo, count badge + primary border when it's in the order.

**Ordering is one surface.** `/pos` is a board of active order cards; **`components/pos/order-modal.tsx`** composes an order over it (destination → dishes + cart rail → confirm) and is the only file that knows create and amend are different. Below it, everything takes a **`CartController`** (`components/pos/cart-types.ts`) and reads *capabilities* — `setHold` present? `canDelete(id)`? — never a mode flag. Create batches locally and commits in one `place_staff_order` call; amend fires each edit as a server action, because a fired line is a KOT amendment needing a reason + audit. `/pos/[orderId]` is a deep link that renders the same screen with the modal open.

**Enum values never reach staff.** `"bill_requested"` → "Bill requested" via a label map (`tableStateLabel`), not `.replace("_", " ")`.

**States are not optional.** Loading, empty (teach the next step — not "No data."), error (say the recovery), success. Destructive actions (delete, void, remove, cancel) confirm via `AlertDialog` and name the real consequence ("printed QR codes stop working"). Never fire-and-forget a server action — always surface `{error}`.

**Motion.** transform/opacity only, ease-out, 150–300ms, `motion-reduce` opt-out. No bounce.

**Known traps** (all cost real debugging time — don't rediscover them):
- `SheetContent` width is the `size` prop (`sm|md|lg|xl|half`), **not** a `className` — a plain `sm:max-w-lg` loses to the base variant-prefixed class on specificity and is silently ignored.
- `Select` labels come from the `items` map our wrapper derives from `SelectItem` children; base-ui's `Select.Value` renders the raw value otherwise (bare UUIDs).
- Server Actions cap bodies at 1MB — `next.config.ts` raises it for uploads. Re-check when adding a file input.
- Hold open editors **by id**, deriving the row from the live list. Storing the object freezes a snapshot, so revalidated data never appears until close/reopen.
- Define components at module scope. Nested in a parent, they remount on every parent render and lose their state — brutal under Realtime.
- **Never key a list row by its content.** A signature key (`item|variant|notes`) changes on every keystroke in that row's input → React remounts the row → the caret is lost mid-word. Key on a stable id; use the signature only to decide merges (`components/pos/cart-types.ts`).
- A **client component may not import from a file that imports `lib/supabase/server`** — it drags `next/headers` into the browser bundle and the build fails. Shared constants belong in a plain module (`lib/pos-constants.ts`, `lib/table-constants.ts`, `lib/order-constants.ts`).
- No `Button` size reaches the 44px tap target (`icon` is 32px, `lg` is 36px). POS steppers pass `size="icon" className="size-11"` — safe here, because both are plain `size-*` utilities that tailwind-merge dedupes, unlike the variant-prefixed `SheetContent` width above.
- `create or replace function` **cannot change a function's arity** — it silently creates an *overload* and leaves the old body live. Changing an RPC's args means `drop` + `create`, then re-issuing `revoke`/`grant` **naming the full new signature**: a new arg list is a new function object, old grants don't carry over, and `public` holds EXECUTE by default.

## Verification
- Test RLS isolation: user of tenant A cannot read tenant B rows — across every table.
- Drive real E2E flows against a seeded demo tenant (order→KOT→KDS→bill→pay→receipt; sell→inventory deduct→alert→PO→GRN; reserve→seat→bill; subscription trial→upgrade→gateway sandbox→feature unlock).
- Reports must reconcile against seeded transactions across all time windows.
- Use Supabase local/dev branch for tests. Never test against a real tenant's data.

## Open questions (unresolved — confirm with owner before the relevant phase)
Payment gateway to launch with · printing approach (local agent vs cloud) · subscription tiers + feature-gating map · delivery model (own drivers vs 3rd-party) · future country tax compliance (Nepal IRD / India GST). See PRD §9.

- Follow the Design system section above (and `@.impeccable.md`) on every UI change.
- Always read the PLANNING.md at the start of every new conversation 
- Check TASKS.md before starting your work
- Mark completed tasks immediately
- Add newly discovered tasks