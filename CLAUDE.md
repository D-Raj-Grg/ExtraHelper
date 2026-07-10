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

## Verification
- Test RLS isolation: user of tenant A cannot read tenant B rows — across every table.
- Drive real E2E flows against a seeded demo tenant (order→KOT→KDS→bill→pay→receipt; sell→inventory deduct→alert→PO→GRN; reserve→seat→bill; subscription trial→upgrade→gateway sandbox→feature unlock).
- Reports must reconcile against seeded transactions across all time windows.
- Use Supabase local/dev branch for tests. Never test against a real tenant's data.

## Open questions (unresolved — confirm with owner before the relevant phase)
Payment gateway to launch with · printing approach (local agent vs cloud) · subscription tiers + feature-gating map · delivery model (own drivers vs 3rd-party) · future country tax compliance (Nepal IRD / India GST). See PRD §9.

- Always read the PLANNING.md at the start of every new conversation 
- Check TASKS.md before starting your work
- Mark completed tasks immediately
- Add newly discovered tasks