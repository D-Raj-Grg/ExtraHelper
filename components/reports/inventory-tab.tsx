import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ReportSection } from "./report-section"
import { StatTiles } from "./stat-tiles"
import type { ReportCtx } from "./types"

type Row = {
  name: string
  uom: string
  current_qty: number
  consumed: number
  wasted: number
  cogs_cents: number
  valuation_cents: number
  reorder_qty: number
}

export async function InventoryTab({ supabase, tenantId, F, T, cur }: ReportCtx) {
  const { data } = await supabase.rpc("report_inventory", { _tenant: tenantId, _from: F, _to: T })
  const rows = (data ?? []) as Row[]

  const disp = rows.map((r) => ({
    item: r.name,
    uom: r.uom,
    on_hand: Number(r.current_qty),
    consumed: Number(r.consumed),
    wasted: Number(r.wasted),
    cogs: money(r.cogs_cents, cur),
    valuation: money(r.valuation_cents, cur),
    reorder: Number(r.reorder_qty),
  }))
  const totalCogs = rows.reduce((s, r) => s + r.cogs_cents, 0)
  const totalVal = rows.reduce((s, r) => s + r.valuation_cents, 0)
  const needsReorder = rows.filter((r) => Number(r.reorder_qty) > 0).length

  return (
    <div className="flex flex-col gap-6">
      <StatTiles
        tiles={[
          { label: "COGS (period)", value: money(totalCogs, cur) },
          { label: "Stock valuation", value: money(totalVal, cur) },
          { label: "Needs reorder", value: String(needsReorder), warn: needsReorder > 0 },
        ]}
      />

      <ReportSection
        title="Inventory report"
        rows={disp}
        columns={[
          { key: "item", label: "Item" },
          { key: "uom", label: "UoM" },
          { key: "on_hand", label: "On hand" },
          { key: "consumed", label: "Consumed" },
          { key: "wasted", label: "Wasted" },
          { key: "cogs", label: "COGS" },
          { key: "valuation", label: "Valuation" },
          { key: "reorder", label: "Reorder qty" },
        ]}
        filename="inventory-report"
        empty="No ingredients tracked yet. Add them under Inventory."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Item</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">On hand</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Consumed</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Wasted</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">COGS</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Valuation</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Reorder</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="px-3 py-2 font-medium">{r.name}</TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(r.current_qty)} {r.uom}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(r.consumed)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {Number(r.wasted)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(r.cogs_cents, cur)}
                </TableCell>
                <TableCell className="px-3 py-2 text-right tabular-nums">
                  {money(r.valuation_cents, cur)}
                </TableCell>
                <TableCell
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    Number(r.reorder_qty) > 0
                      ? "font-medium text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                  )}
                >
                  {Number(r.reorder_qty)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
