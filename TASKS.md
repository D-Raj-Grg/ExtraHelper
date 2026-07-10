# TASKS — ExtraHelper

> Check this before starting work. Mark tasks done immediately (`[x]`). Add newly discovered tasks under the right milestone (or Backlog). Milestones map to `PLANNING.md` §6. Full spec: PRD.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (see Open Questions)

---

## Milestone 0 — Foundation
- [ ] Create Supabase project (dev + prod); wire env/secrets (service role server-only)
- [ ] Install/verify toolchain: Node LTS, Supabase CLI, Docker, Flutter SDK, Xcode, Android Studio
- [ ] Set up Supabase CLI local stack + migration workflow + seed script
- [ ] Design core schema (tenancy → users → tables/menu/orders/bills/inventory) as SQL migrations
- [ ] Add `tenant_id` (+ `branch_id`) to every business table
- [ ] Baseline **RLS policies** on every table keyed on JWT `tenant_id` + `role`
- [ ] Auth: email/OTP/social; JWT custom claims (`tenant_id`, `role`)
- [ ] RBAC role model + `roles` table + app-level guards
- [ ] `audit_logs` table + write helper (actor + timestamp)
- [ ] Next.js app shell (App Router) — read `node_modules/next/dist/docs/` first; routing, auth, layout, tenant context
- [ ] Flutter app shell (iOS + Android) — Supabase SDK, auth, navigation, tenant context
- [ ] Tenant onboarding wizard (profile, currency, tax, branches, branding)
- [ ] Super-admin console skeleton (tenant list, activate/suspend)
- [ ] Per-tenant settings model (currency, tax rules, service charge, receipt template, fees)
- [ ] Integration adapter interfaces stubbed: payments, printing, notifications
- [ ] **Verify:** RLS isolation test — tenant A cannot read tenant B rows (all tables)

## Milestone 1 — Core Operations (P0)
- [ ] Menu management: categories, items, variants, modifiers, combos, images, 86 toggle, availability schedules
- [ ] Kitchen stations + per-item station routing config
- [ ] Floor/table management: floors/areas, visual floor map, capacity, table states
- [ ] Table QR code generation (stable token per table)
- [ ] Waiter ordering (Flutter): build order, modifiers, notes, course/seat, hold vs fire
- [ ] Order lifecycle state machine (`draft→placed→in_kitchen→preparing→ready→served→billed→closed`)
- [ ] KOT generation on fire — split per station, each its own ticket
- [ ] KOT amendments (added/void items, reason + approval for voids)
- [ ] KDS full-screen web view per station: ticket aging colors, item/ticket bump, all-day counts, recall
- [ ] 86 item from KDS → disables item on all ordering surfaces (realtime)
- [ ] Thermal KOT print (ESC/POS via adapter)
- [ ] Realtime sync: table states + KOT + order status across waiter/KDS/cashier
- [ ] **Verify:** order → KOT fires → KDS + print → bump → served (E2E on demo tenant)

## Milestone 2 — Billing / POS
- [ ] Running bill per table/order (multi-order per bill)
- [ ] Line pricing pulls price + tax class from menu
- [ ] Configurable tax (multiple rates, inclusive/exclusive), service charge %, packaging charge — computed in trusted SQL
- [ ] Discounts: %/flat, item + bill level, coupon codes, manager approval threshold
- [ ] Split bills: by item / by seat / equal / arbitrary amounts
- [ ] Partial payments (pay now, remainder later)
- [ ] Payment methods: cash, card (manual), split across methods; record + status
- [ ] Void/refund with reason + role approval + audit trail
- [ ] Receipt template (logo, tax breakup, footer/terms) → thermal print + digital (email/SMS/QR link)
- [ ] Cash session open/close, expected vs counted reconciliation, shift report
- [ ] **Verify:** bill → split payment → receipt; day-close reconciles (E2E)

## Milestone 3 — Inventory
- [ ] Inventory items: UoM, category, reorder level, par level, cost
- [ ] Recipe/BOM mapping: menu item → ingredient quantities
- [ ] Auto-deduct stock on sale (trusted trigger/function)
- [ ] Stock movements: sale, wastage, staff meal, transfer
- [ ] Suppliers + purchase orders + receive (GRN, partial/full) + price history
- [ ] Stock counts/audits → variance (theoretical vs actual) → wastage/shrinkage
- [ ] Low-stock / reorder / out-of-stock alerts + suggested reorder qty
- [ ] Barcode/QR scanner support (stock-in + counts)
- [ ] Multi-branch stock (per branch)
- [ ] Valuation (FIFO/avg cost) + consumption views by time window
- [ ] **Verify:** sell dish → stock deducts per recipe → alert → PO → GRN restocks (E2E)

## Milestone 4 — Reporting & Analytics
- [ ] Reporting aggregation layer (server-side) with windows: today/daily/weekly/monthly/yearly/all-time + custom range + prev-period compare
- [ ] Sales reports: by item, category, hour, table, waiter, payment method, order type
- [ ] Billing dashboard: revenue, tax, discounts, voids, refunds, avg ticket, turnover
- [ ] Inventory reports: consumption, COGS, wastage, valuation, reorder needs
- [ ] Staff reports: sales/waiter, orders handled, shift hours, tips
- [ ] Customer/loyalty reports: repeat rate, top customers, redemption
- [ ] Owner dashboard: KPI tiles + charts (web + mobile)
- [ ] Exports: CSV / PDF
- [ ] **Verify:** report totals reconcile vs seeded transactions across all windows

## Milestone 5 — Customer Channels
- [ ] QR dine-in ordering page: scan → menu → order → (optional) pay-at-table; call-waiter / request-bill
- [ ] Reservations/booking: date/time/party size, availability from floor capacity + slot rules, confirm + reminder (email/SMS), host board, optional deposit
- [ ] Online storefront (per-tenant subdomain/slug): menu, cart, address, delivery/pickup slot, order-type fee
- [ ] Delivery status tracking
- [ ] Loyalty/CRM: customer accounts, points earn/burn, tiers, offers/coupons, order history, post-visit feedback/ratings
- [ ] Multiple menus (dine-in vs delivery pricing, happy-hour) + schedules
- [ ] **Verify:** QR/online order lands in KDS; reservation blocks table → seat → bill (E2E)

## Milestone 6 — Payments & SaaS Monetization
- [ ] Online payment gateway adapter (Stripe + regional e-wallet), per-tenant config, sandbox first
- [ ] Customer payment flows (QR pay-at-table, online prepay) + webhook reconciliation
- [ ] Wallet/loyalty points as payment method
- [ ] Subscription plans (Starter/Pro/Enterprise), per-branch/per-seat, monthly/yearly, trial
- [ ] Platform subscription billing + invoices + dunning
- [ ] Feature gating by plan (feature flags)
- [ ] Super-admin: usage metrics, audited impersonation
- [ ] **Verify:** trial → upgrade → gateway sandbox charge → feature unlocks (E2E)

## Milestone 7 — Hardening & Scale
- [ ] Offline queue + sync (waiter/cashier): local persist, idempotency keys, server-timestamp conflict resolution
- [ ] Multi-branch rollups (per-branch + tenant aggregate)
- [ ] Performance: POS/KDS < 200ms perceived, optimistic UI, report pagination
- [ ] Full audit/compliance polish
- [ ] Localization: currency/number/date formats, i18n string scaffolding
- [ ] Security pass: RLS coverage audit, secret handling, PII minimization
- [ ] Mobile store release (Apple Developer + Google Play)

---

## Backlog / Discovered
- [ ] _(add newly discovered tasks here, then file under the right milestone)_

## Blocked — Open Questions (PRD §9)
- [!] Launch payment gateway(s): Stripe global vs regional e-wallet?
- [!] Printing approach: local agent vs cloud print service?
- [!] Subscription tiers + feature-gating map?
- [!] Delivery model: own drivers vs 3rd-party couriers?
- [!] Future country tax compliance (Nepal IRD / India GST)?
