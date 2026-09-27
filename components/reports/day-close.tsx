import { AlertTriangleIcon, ImageIcon, ScaleIcon, ZapIcon } from "lucide-react"

import { ExportButtons } from "@/components/export-buttons"
import { PrintDayReportButton } from "@/components/reports/print-day-report-button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { variance } from "@/components/cash/variance"
import { formatDateTime, money } from "@/lib/format"
import { paymentMethodLabel } from "@/lib/payment-constants"
import { cn } from "@/lib/utils"
import { ReportEmpty, ReportSection, TableFrame } from "./report-section"
import { StatTiles, type Tile } from "./stat-tiles"
import { CashBook } from "./cash-book"
import {
  marginLabel,
  topItemColumns,
  topItemRows,
  TopItemsTable,
  UncostedHint,
} from "./profit"
import { paidFromLabel } from "@/lib/expense-constants"
import { DayOrders } from "./day-orders"
import type { DayOrder } from "./day-order-utils"
import { cutoffLabel, type DayReport } from "./day-report"

function signedMoney(cents: number, currency: string) {
  return `${cents > 0 ? "+" : ""}${money(cents, currency)}`
}

/**
 * The day-close (Z) sheet: one business day, everything needed to shut the till.
 *
 * Reads a single `daily_report` payload, so every figure on the page came from
 * one consistent snapshot — a sheet assembled from six independent queries can
 * disagree with itself while the reader is looking at it.
 */
export function DayClose({
  r,
  orders,
  ordersTruncated,
  canViewProfit,
}: {
  r: DayReport
  orders: DayOrder[]
  ordersTruncated: boolean
  /** profit.view — the order rows carry cost snapshots only when true. */
  canViewProfit: boolean
}) {
  const cur = r.currency
  const s = r.sales
  const cash = r.cash
  const book = r.cash_book
  const exp = r.expenses
  const cut = cutoffLabel(r.cutoff_minutes)

  // The payload strips every profit key for callers without profit.view, so
  // presence is the permission check; a missing figure is not a zero.
  const gross = s.gross_profit_cents ?? null
  // Gross profit minus what was logged as spent today. Not a P&L — expenses
  // here are the day's petty ledger, not rent or wages — so it is labelled as
  // exactly that sum and nothing grander.
  const afterExpenses = gross != null && exp.total_cents > 0 ? gross - exp.total_cents : null

  // The reconciliation gap, stated rather than hidden — see DayReport.carried_cents.
  const carried = r.carried_cents

  const profitTiles: Tile[] =
    gross != null
      ? [
          { label: "Gross profit", value: money(gross, cur) },
          { label: "Margin", value: marginLabel(s.margin_pct), hint: "on net item sales after refunds" },
        ]
      : []

  // One flat CSV for the whole sheet: a manager filing a day wants one file,
  // not eight. The per-section buttons still export their own table.
  const csvRows = [
    { section: "Sales", label: "Gross (subtotal)", count: "", amount: money(s.subtotal_cents, cur) },
    { section: "Sales", label: "Discounts", count: "", amount: money(-s.discount_cents, cur) },
    { section: "Sales", label: "Service charge", count: "", amount: money(s.service_cents, cur) },
    { section: "Sales", label: "Tax", count: "", amount: money(s.tax_cents, cur) },
    { section: "Sales", label: "Tips", count: "", amount: money(s.tip_cents, cur) },
    { section: "Sales", label: "Rounding", count: "", amount: money(s.rounding_cents, cur) },
    { section: "Sales", label: "Revenue", count: String(s.bills), amount: money(s.revenue_cents, cur) },
    { section: "Sales", label: "Average ticket", count: "", amount: money(s.avg_cents, cur) },
    ...(gross != null
      ? [
          {
            section: "Sales",
            label: "Cost of goods",
            count: "",
            amount: money(s.cogs_cents ?? 0, cur),
          },
          ...((s.refunds_cents ?? 0) > 0
            ? [{ section: "Sales", label: "Refunds", count: "", amount: money(-(s.refunds_cents ?? 0), cur) }]
            : []),
          {
            section: "Sales",
            label: `Gross profit (${marginLabel(s.margin_pct)} on net item sales after refunds)`,
            count: "",
            amount: money(gross, cur),
          },
        ]
      : []),
    ...r.payments.map((p) => ({
      section: "Payments",
      label: paymentMethodLabel(p.method),
      count: String(p.count),
      amount: money(p.amount_cents, cur),
    })),
    {
      section: "Payments",
      label: "Payments total",
      count: "",
      amount: money(r.payments_total_cents, cur),
    },
    { section: "Counts", label: "Bills", count: String(s.bills), amount: "" },
    { section: "Counts", label: "Tables served", count: String(s.tables_served), amount: "" },
    {
      section: "Counts",
      label: "Voids",
      count: String(r.voids.count),
      amount: money(r.voids.value_cents, cur),
    },
    {
      section: "Counts",
      label: "Cancellations",
      count: String(r.cancellations.count),
      amount: money(r.cancellations.value_cents, cur),
    },
    {
      section: "Counts",
      label: "Refunds",
      count: String(r.refunds.count),
      amount: money(r.refunds.total_cents, cur),
    },
    { section: "Counts", label: "Voided bills", count: String(r.void_bills), amount: "" },
    ...r.expenses.items.map((x) => ({
      section: "Expenses",
      label: `${x.category} — ${x.note} (${paidFromLabel(x.paid_from)})`,
      count: "",
      amount: money(-x.amount_cents, cur),
    })),
    { section: "Cash book", label: "Expected cash", count: "", amount: money(book.expected_cash_cents, cur) },
    { section: "Cash book", label: "Counted cash", count: "", amount: countedOrBlank(book.counted_cash_cents, cur) },
    { section: "Cash book", label: "Expected online", count: "", amount: money(book.expected_online_cents, cur) },
    { section: "Cash book", label: "Counted online", count: "", amount: countedOrBlank(book.counted_online_cents, cur) },
    ...cash.sessions.map((x) => ({
      section: "Cash drawer",
      label: x.cashier ?? "Unknown cashier",
      count: "",
      amount: signedMoney(x.variance_cents ?? 0, cur),
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{r.day_label}</h2>
          <p className="text-sm text-muted-foreground">
            {cut
              ? `Trading day runs ${cut} to ${cut} the next morning.`
              : "Trading day runs midnight to midnight."}{" "}
            Times in {r.timezone}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintDayReportButton day={r.day} />
          <ExportButtons
            rows={csvRows}
            columns={[
              { key: "section", label: "Section" },
              { key: "label", label: "Item" },
              { key: "count", label: "Count" },
              { key: "amount", label: "Amount" },
            ]}
            filename={`day-close-${r.day}`}
          />
        </div>
      </div>

      {cash.open_count > 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
          {cash.open_count} cash {cash.open_count === 1 ? "drawer is" : "drawers are"} still open.
          The cash reconciliation below covers closed sessions only.
        </p>
      ) : null}

      <StatTiles
        tiles={[
          { label: "Revenue", value: money(s.revenue_cents, cur) },
          { label: "Bills", value: String(s.bills) },
          { label: "Avg ticket", value: money(s.avg_cents, cur) },
          ...profitTiles,
          { label: "Tax", value: money(s.tax_cents, cur) },
          { label: "Service", value: money(s.service_cents, cur) },
          { label: "Discounts", value: money(s.discount_cents, cur) },
          {
            label: "Voids",
            value: `${r.voids.count} · ${money(r.voids.value_cents, cur)}`,
            warn: r.voids.count > 0,
          },
          {
            label: "Cancellations",
            value: `${r.cancellations.count} · ${money(r.cancellations.value_cents, cur)}`,
            warn: r.cancellations.count > 0,
          },
          {
            label: "Refunds",
            value: money(r.refunds.total_cents, cur),
            warn: r.refunds.total_cents > 0,
          },
        ]}
      />
      <UncostedHint n={s.uncosted_lines} />

      <DayOrders
        orders={orders}
        currency={cur}
        timezone={r.timezone}
        truncated={ordersTruncated}
        revenueCents={s.revenue_cents}
        showProfit={canViewProfit}
      />

      <ReportSection
        title="Sales breakdown"
        rows={csvRows.filter((x) => x.section === "Sales")}
        columns={[
          { key: "label", label: "Line" },
          { key: "amount", label: "Amount" },
        ]}
        filename={`day-close-sales-${r.day}`}
        empty="No paid bills on this day."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Line</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <MoneyRow label="Gross (subtotal)" cents={s.subtotal_cents} cur={cur} />
            <MoneyRow label="Discounts" cents={-s.discount_cents} cur={cur} />
            <MoneyRow label="Service charge" cents={s.service_cents} cur={cur} />
            <MoneyRow label="Tax" cents={s.tax_cents} cur={cur} />
            <MoneyRow label="Tips" cents={s.tip_cents} cur={cur} />
            <MoneyRow label="Rounding" cents={s.rounding_cents} cur={cur} />
            <TableRow>
              <TableCell className="px-3 py-2 font-semibold">Revenue</TableCell>
              <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(s.revenue_cents, cur)}
              </TableCell>
            </TableRow>
            {gross != null ? (
              <>
                <MoneyRow label="Cost of goods" cents={-(s.cogs_cents ?? 0)} cur={cur} />
                {(s.refunds_cents ?? 0) > 0 ? (
                  <MoneyRow label="Refunds" cents={-(s.refunds_cents ?? 0)} cur={cur} />
                ) : null}
                <TableRow>
                  <TableCell className="px-3 py-2 font-semibold">
                    Gross profit
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {marginLabel(s.margin_pct)} on net item sales after refunds
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">
                    {money(gross, cur)}
                  </TableCell>
                </TableRow>
              </>
            ) : null}
          </TableBody>
        </Table>
      </ReportSection>

      <ReportSection
        title="Payments taken"
        rows={r.payments.map((p) => ({
          method: paymentMethodLabel(p.method),
          count: p.count,
          amount: money(p.amount_cents, cur),
        }))}
        columns={[
          { key: "method", label: "Method" },
          { key: "count", label: "Count" },
          { key: "amount", label: "Amount" },
        ]}
        filename={`day-close-payments-${r.day}`}
        empty="Nothing was tendered on this day."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Method</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Count</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.payments.map((p) => (
              <TableRow key={p.method}>
                <TableCell className="px-3 py-2">{paymentMethodLabel(p.method)}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.count}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(p.amount_cents, cur)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="px-3 py-2 font-semibold">Payments total</TableCell>
              <TableCell />
              <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(r.payments_total_cents, cur)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ReportSection>

      {carried !== 0 ? (
        <p className="text-sm text-muted-foreground">
          {carried > 0
            ? `${money(carried, cur)} of what was taken today settles bills raised on an earlier day, which is why payments exceed revenue.`
            : `${money(-carried, cur)} of today's bills has not been tendered yet, which is why revenue exceeds payments.`}
        </p>
      ) : null}

      <CashBook day={r.day} book={book} currency={cur} timezone={r.timezone} />

      <ReportSection
        title={`Expenses · ${money(exp.total_cents, cur)}`}
        rows={exp.items.map((x) => ({
          time: x.time,
          category: x.category,
          note: x.note,
          paid_from: paidFromLabel(x.paid_from),
          by: x.by ?? "",
          amount: money(x.amount_cents, cur),
        }))}
        columns={[
          { key: "time", label: "Time" },
          { key: "category", label: "Category" },
          { key: "note", label: "What" },
          { key: "paid_from", label: "Paid from" },
          { key: "by", label: "By" },
          { key: "amount", label: "Amount" },
        ]}
        filename={`day-close-expenses-${r.day}`}
        empty="No expenses logged on this day."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Time</TableHead>
              <TableHead className="px-3 py-2 font-medium">What</TableHead>
              <TableHead className="px-3 py-2 font-medium">Paid from</TableHead>
              <TableHead className="px-3 py-2 font-medium">By</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exp.items.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="px-3 py-2 tabular-nums text-muted-foreground">{x.time}</TableCell>
                <TableCell className="px-3 py-2">
                  <span className="block">{x.note}</span>
                  <span className="text-xs text-muted-foreground">{x.category}</span>
                  {x.receipt_url ? (
                    <a
                      href={x.receipt_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline print:hidden"
                    >
                      <ImageIcon className="size-3" aria-hidden />
                      Receipt
                    </a>
                  ) : null}
                </TableCell>
                <TableCell className="px-3 py-2">{paidFromLabel(x.paid_from)}</TableCell>
                <TableCell className="px-3 py-2 text-muted-foreground">{x.by ?? "—"}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(x.amount_cents, cur)}
                </TableCell>
              </TableRow>
            ))}
            {exp.by_category.map((c) => (
              <TableRow key={`cat-${c.name}`} className="bg-muted/30">
                <TableCell />
                <TableCell className="px-3 py-2 text-muted-foreground" colSpan={3}>
                  {c.name} · {c.count}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {money(c.amount_cents, cur)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell />
              <TableCell className="px-3 py-2 font-semibold" colSpan={3}>
                Total expenses
              </TableCell>
              <TableCell className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(exp.total_cents, cur)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ReportSection>

      {afterExpenses != null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScaleIcon className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">After expenses</span>{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {money(afterExpenses, cur)}
            </span>{" "}
            — gross profit ({money(gross ?? 0, cur)}) minus today&apos;s logged expenses (
            {money(exp.total_cents, cur)}). Not a full P&amp;L: only what was logged here counts.
          </span>
        </p>
      ) : null}

      {/* The shift drawer only shows for tenants that use it, or on a day one ran. */}
      {r.cash_drawer_enabled || cash.sessions.length > 0 ? (
        <ReportSection
          title="Cash drawer"
          rows={cash.sessions.map((x) => ({
            cashier: x.cashier ?? "Unknown",
            closed: x.closed_at ? formatDateTime(x.closed_at, r.timezone) : "—",
            float: money(x.opening_float_cents, cur),
            out: money(x.payouts_cents, cur),
            expected: money(x.expected_cents ?? 0, cur),
            counted: money(x.counted_cents ?? 0, cur),
            variance: signedMoney(x.variance_cents ?? 0, cur),
          }))}
          columns={[
            { key: "cashier", label: "Cashier" },
            { key: "closed", label: "Closed" },
            { key: "float", label: "Float" },
            { key: "out", label: "Cash out" },
            { key: "expected", label: "Expected" },
            { key: "counted", label: "Counted" },
            { key: "variance", label: "Variance" },
          ]}
          filename={`day-close-cash-${r.day}`}
          empty="No drawer was closed on this day."
        >
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">Cashier</TableHead>
                <TableHead className="px-3 py-2 font-medium">Closed</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Float</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Cash out</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Expected</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Counted</TableHead>
                <TableHead className="px-3 py-2 text-right font-medium">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cash.sessions.map((x) => {
                const v = variance(x.variance_cents ?? 0)
                return (
                  <TableRow key={x.id}>
                    <TableCell className="px-3 py-2 font-medium">{x.cashier ?? "Unknown"}</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {x.closed_at ? formatDateTime(x.closed_at, r.timezone) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {money(x.opening_float_cents, cur)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {x.payouts_cents > 0 ? `−${money(x.payouts_cents, cur)}` : "—"}
                      {x.paid_in_cents > 0 ? (
                        <span className="block text-xs">+{money(x.paid_in_cents, cur)} in</span>
                    ) : null}
                    {x.auto_approved_count > 0 ? (
                      <span
                        className="mt-0.5 flex items-center justify-end gap-1 text-xs text-amber-600 dark:text-amber-400"
                        title="Approved by the close, not by a manager"
                      >
                        <ZapIcon className="size-3" />
                        {x.auto_approved_count} auto
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {money(x.expected_cents ?? 0, cur)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {money(x.counted_cents ?? 0, cur)}
                  </TableCell>
                  <TableCell className={cn("px-3 py-2 text-right tabular-nums", v.tone)}>
                    <span className="font-medium">{signedMoney(x.variance_cents ?? 0, cur)}</span>
                    <span className="ml-2 text-xs opacity-80">{v.label}</span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ReportSection>
      ) : null}

      <ReportSection
        title="Top items"
        rows={topItemRows(r.top_items, cur, canViewProfit)}
        columns={topItemColumns(canViewProfit)}
        filename={`day-close-top-items-${r.day}`}
        empty="Nothing was sold on this day."
      >
        <TopItemsTable items={r.top_items} cur={cur} showProfit={canViewProfit} />
      </ReportSection>

      {/* A quiet day is a real answer, not a missing one — the tiles above still
          read zero, so this only explains why the tables are empty. */}
      {s.bills === 0 ? (
        <ReportEmpty>
          Nothing was billed on this day. Take an order on the POS and settle it, and its figures
          land here.
        </ReportEmpty>
      ) : null}

      <TableFrame>
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Counts</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Number</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <CountRow label="Bills" n={s.bills} />
            <CountRow label="Tables served" n={s.tables_served} />
            <CountRow
              label="Voided lines"
              n={r.voids.count}
              value={money(r.voids.value_cents, cur)}
            />
            <CountRow
              label="Cancelled orders"
              n={r.cancellations.count}
              value={money(r.cancellations.value_cents, cur)}
            />
            <CountRow
              label="Refunds"
              n={r.refunds.count}
              value={money(r.refunds.total_cents, cur)}
            />
            <CountRow label="Voided bills" n={r.void_bills} />
          </TableBody>
        </Table>
      </TableFrame>
    </div>
  )
}

function countedOrBlank(cents: number | null, cur: string) {
  return cents !== null ? money(cents, cur) : ""
}

function MoneyRow({ label, cents, cur }: { label: string; cents: number; cur: string }) {
  return (
    <TableRow>
      <TableCell className="px-3 py-2 text-muted-foreground">{label}</TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">{money(cents, cur)}</TableCell>
    </TableRow>
  )
}

function CountRow({ label, n, value }: { label: string; n: number; value?: string }) {
  return (
    <TableRow>
      <TableCell className="px-3 py-2">{label}</TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums">{n}</TableCell>
      <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {value ?? "—"}
      </TableCell>
    </TableRow>
  )
}
