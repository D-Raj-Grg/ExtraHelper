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

type FoodCostRow = {
  menu_item_id: string
  name: string
  sale_price_cents: number
  plate_cost_cents: number
  food_cost_pct: number | null
  margin_cents: number
  ingredient_count: number
}

export async function InventoryTab({ supabase, tenantId, F, T, cur }: ReportCtx) {
  const [{ data }, { data: foodCost }] = await Promise.all([
    supabase.rpc("report_inventory", { _tenant: tenantId, _from: F, _to: T }),
    supabase.rpc("report_dish_food_cost", { _tenant: tenantId }),
  ])
  const rows = (data ?? []) as Row[]
  const dishes = (foodCost ?? []) as FoodCostRow[]

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

      <ReportSection
        title="Menu food cost"
        rows={dishes.map((d) => ({
          dish: d.name,
          sale: money(d.sale_price_cents, cur),
          plate_cost: money(d.plate_cost_cents, cur),
          food_cost_pct: d.food_cost_pct == null ? "—" : `${Number(d.food_cost_pct)}%`,
          margin: money(d.margin_cents, cur),
        }))}
        columns={[
          { key: "dish", label: "Dish" },
          { key: "sale", label: "Sale price" },
          { key: "plate_cost", label: "Plate cost" },
          { key: "food_cost_pct", label: "Food cost %" },
          { key: "margin", label: "Margin" },
        ]}
        filename="menu-food-cost"
        empty="No dishes yet. Map recipes under Inventory to see food cost."
      >
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-3 py-2 font-medium">Dish</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Sale price</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Plate cost</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Food cost %</TableHead>
              <TableHead className="px-3 py-2 text-right font-medium">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dishes.map((d) => {
              const pct = d.food_cost_pct == null ? null : Number(d.food_cost_pct)
              const unmapped = d.ingredient_count === 0
              return (
                <TableRow key={d.menu_item_id}>
                  <TableCell className="px-3 py-2 font-medium">{d.name}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {money(d.sale_price_cents, cur)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {unmapped ? (
                      <span className="text-amber-600 dark:text-amber-400">No recipe</span>
                    ) : (
                      money(d.plate_cost_cents, cur)
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "px-3 py-2 text-right tabular-nums font-medium",
                      pct == null
                        ? "text-muted-foreground"
                        : pct <= 35
                          ? "text-emerald-600 dark:text-emerald-400"
                          : pct <= 45
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-destructive",
                    )}
                  >
                    {pct == null ? "—" : `${pct}%`}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums">
                    {money(d.margin_cents, cur)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  )
}
