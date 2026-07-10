# PLANNING — ExtraHelper

> Read this at the start of every session. Full spec: PRD at `/Users/almighty/.claude/plans/1-help-me-to-wondrous-bird.md`. Working rules: `CLAUDE.md`. Task list: `TASKS.md`.

---

## 1. Vision

**One system to run a restaurant end to end — sold to many restaurants as SaaS.**

Restaurants today stitch together separate tools for POS, KOT printing, kitchen screens, inventory, reservations, and delivery. ExtraHelper replaces that stack with a single multi-tenant platform covering front-of-house (ordering, billing, tables) and back-of-house (kitchen, inventory, purchasing), plus customer-facing channels (QR dine-in, online order/delivery, reservations, loyalty) — with owner analytics across every time window.

**Who it serves:** independent restaurants, cafés, and small chains — from a single outlet to multi-branch operators.

**Business model:** per-tenant subscription (Starter / Pro / Enterprise), feature-gated by plan, optionally per-branch or per-seat.

**Product principles**
- **Fast on the floor** — waiters, cashiers, and kitchen move at service speed. Optimistic UI, realtime, works offline.
- **Trustworthy money** — bills, tax, splits, and cash reconciliation are exact and auditable.
- **Tenant data never leaks** — isolation enforced at the database, not just the app.
- **Configurable, not hardcoded** — currency, tax, receipts adapt per tenant; integrations are pluggable.
- **Ship value in phases** — each phase is independently useful (see §6).

**Success signals:** a restaurant can take an order → fire KOT → serve → bill → reconcile cash in one system; inventory self-updates from sales; owner sees live revenue on their phone; a new restaurant onboards itself and subscribes.

---

## 2. Architecture

### Clients
- **Next.js web (App Router)** — admin console, POS/cashier, KDS (kitchen screen mode), super-admin console, public storefront + QR ordering pages. SSR for public/SEO pages; client + realtime for POS/KDS.
- **Flutter mobile (iOS + Android)** — waiter ordering, manager ops, inventory, owner dashboard.
- **KDS** — full-screen web view per kitchen station.

### Backend — Supabase (single Postgres)
- **Auth** — email/OTP/social; JWT carries `tenant_id` + `role`.
- **Postgres + RLS** — every business table scoped by `tenant_id` (and `branch_id`); RLS policies are the isolation boundary. Business logic (bill totals, inventory deduction, cash reconciliation) lives in SQL functions/triggers where it must be trusted.
- **Realtime** — KDS tickets, table states, KOT firing, 86 items, order status; channels scoped by tenant/branch/station.
- **Storage** — menu images, receipts, branding.
- **Edge Functions** — payment/webhook callbacks, print jobs, notifications, scheduled reports/dunning. Hold the service role (server-only).

### Multi-tenancy
- Single shared database. `tenant_id` on every business row. `branch_id` for multi-outlet tenants (per-branch inventory/reports, rolled up per tenant).
- Super-admin uses service role, server-side only; impersonation is audited.

### Cross-cutting patterns
- **Adapters** for all external integrations (payment gateway, printer, notifications) → pluggable + per-tenant config, no vendor hardcoded in business logic.
- **Offline-first** waiter/cashier: local queue for orders + payments, sync on reconnect, idempotency keys, server-timestamp conflict resolution.
- **Audit log** for voids/discounts/refunds/price-changes/impersonation.
- **Config-driven** currency/tax/service-charge/receipt-template/order-type-fees per tenant.

### High-level flow
```
Waiter app / QR page ─┐
                      ├─▶ Supabase (Postgres + RLS + Realtime) ──▶ KDS screen
Cashier POS (web) ────┘         │                                  (realtime tickets)
                                ├─▶ Edge Functions ──▶ Payment gateway (adapter)
                                │                  └─▶ Printer service (ESC/POS)
                                │                  └─▶ Email/SMS (adapter)
Owner dashboard (mobile/web) ◀──┘ (aggregated reports)
```

---

## 3. Technology Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Web framework | **Next.js (App Router)** | ⚠️ Breaking changes vs training data — read `node_modules/next/dist/docs/` first (see `AGENTS.md`). |
| Web language | TypeScript | |
| Web styling/UI | Tailwind CSS + component lib (shadcn/ui available via MCP) | Confirm during Phase 0. |
| Mobile | **Flutter (Dart)** — iOS + Android | Supabase Flutter SDK. |
| Backend / DB | **Supabase** — Postgres, Auth, Realtime, Storage, Edge Functions | RLS = isolation boundary. |
| DB access | Supabase JS client (web) / Supabase Flutter (mobile); SQL migrations | Trusted logic in SQL functions/triggers. |
| Serverless | Supabase Edge Functions (Deno/TypeScript) | Webhooks, print, notify, scheduled jobs. |
| Payments | Adapter → Stripe (global) + regional e-wallets (eSewa/Khalti/…) | Per-tenant config. Launch gateway TBD (PRD §9). |
| Subscription billing | Stripe Billing or equivalent | Platform-level, plan feature-gating. |
| Printing | ESC/POS via local print agent or cloud print (PrintNode-style) | Approach TBD (PRD §9). |
| Notifications | Email + SMS behind an adapter | Provider TBD. |
| Package manager (web) | npm (`npm run dev`) | |

---

## 4. Required Tools & Accounts

### Local dev
- **Node.js** (LTS) + npm — web app.
- **Flutter SDK** + Dart; **Xcode** (iOS build/sim, macOS) + **Android Studio / Android SDK** (Android build/emulator).
- **Supabase CLI** — local stack, migrations, DB branches for tests.
- **Docker** — required by Supabase local stack.
- **Git**.
- **`.env` / env management** — no secrets committed; service role key server-only.

### Accounts / services (as phases need them)
- **Supabase** project (dev + prod).
- **Payment gateway** account(s) — Stripe and/or regional e-wallet (sandbox first).
- **SMS + email** provider accounts.
- **Print service** account if cloud-print chosen.
- **Apple Developer** + **Google Play** accounts — mobile store distribution.

### Hardware (for integration testing)
- **ESC/POS thermal printer** (network or via local agent) — KOT + receipts.
- **Barcode/QR scanner** — inventory + coupons/table QR.

### Testing / verification
- Supabase local or DB branch — **never test against real tenant data**.
- Seeded demo tenant for E2E flows.
- Playwright (available via MCP) for web E2E; Flutter integration tests for mobile.
- Payment gateway **sandbox** for pay flows.

---

## 5. Roles (per-tenant RBAC)
Super Admin (platform) · Owner/Admin · Manager · Receptionist/Host · Cashier · Waiter · Kitchen/KDS · Inventory/Store Keeper · Customer. Full permission matrix: PRD §1 / `CLAUDE.md`.

---

## 6. Phased Roadmap (delivery order)
0. **Foundation** — Supabase schema + RLS baseline, auth/roles, Next.js + Flutter shells, tenant onboarding, super-admin skeleton.
1. **Core ops** — menu, floor/tables, waiter ordering, KOT + station routing, KDS, thermal KOT print, realtime states.
2. **Billing/POS** — running bills, configurable tax/service/discounts, split/partial, payments (cash+card), receipt print, cash day-close.
3. **Inventory** — items, recipe/BOM auto-deduct, suppliers/PO/GRN, counts/wastage, low-stock alerts.
4. **Reporting** — sales/billing/inventory/staff dashboards, all time windows + comparisons, exports.
5. **Customer channels** — QR dine-in, reservations, online order/delivery storefront, loyalty/CRM.
6. **Payments + SaaS monetization** — online gateway, subscription plans, platform billing, feature gating, dunning.
7. **Hardening** — offline sync robustness, multi-branch rollups, perf, localization.

Track granular work in `TASKS.md`.

---

## 7. Open Questions (blockers to resolve per phase — PRD §9)
1. Launch payment gateway(s) — Stripe global vs regional e-wallet?
2. Printing — local agent vs cloud print service?
3. Subscription tiers + feature-gating map?
4. Delivery — own drivers/dispatch vs 3rd-party couriers?
5. Future country tax compliance (Nepal IRD / India GST) despite generic-now decision?
