"use client"

import { useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StockTab } from "./stock-tab"
import { RecipesTab } from "./recipes-tab"
import { CountsTab } from "./counts-tab"
import { CostingTab } from "./costing-tab"
import type {
  CostRow,
  CountRow,
  Item,
  MenuOpt,
  ModifierIngredient,
  ModifierOpt,
  Recipe,
  SupplierOpt,
  UnitOpt,
  VariantOpt,
} from "./types"

export function InventoryManager({
  currency,
  timezone,
  items,
  menu,
  recipes,
  variants,
  modifiers,
  modifierIngredients,
  suppliers,
  costHistory,
  counts,
  units,
  canCount,
  canViewProfit,
  defaultTab = "stock",
}: {
  currency: string
  timezone: string
  items: Item[]
  menu: MenuOpt[]
  recipes: Recipe[]
  variants: VariantOpt[]
  modifiers: ModifierOpt[]
  modifierIngredients: ModifierIngredient[]
  suppliers: SupplierOpt[]
  costHistory: CostRow[]
  counts: CountRow[]
  units: UnitOpt[]
  canCount: boolean
  /** `profit.view` — the Costing tab shows cost prices and margins. */
  canViewProfit: boolean
  /** Deep link (`?tab=costing`); already validated by the page. */
  defaultTab?: "stock" | "recipes" | "costing" | "counts"
}) {
  // A tab this role can't see falls back to Stock rather than an empty panel.
  const initialTab =
    (defaultTab === "costing" && !canViewProfit) || (defaultTab === "counts" && !canCount) ? "stock" : defaultTab

  // Cost history grouped by item, newest first (input already sorted newest-first).
  const historyByItem = useMemo(() => {
    const map = new Map<string, CostRow[]>()
    for (const row of costHistory) {
      const list = map.get(row.inventory_item_id)
      if (list) list.push(row)
      else map.set(row.inventory_item_id, [row])
    }
    return map
  }, [costHistory])

  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue={initialTab}>
        <TabsList variant="line" className="mb-6 w-full justify-start overflow-x-auto">
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          {canViewProfit ? <TabsTrigger value="costing">Costing</TabsTrigger> : null}
          {canCount ? <TabsTrigger value="counts">Stock counts</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="stock">
          <StockTab
            currency={currency}
            timezone={timezone}
            items={items}
            suppliers={suppliers}
            units={units}
            historyByItem={historyByItem}
          />
        </TabsContent>
        <TabsContent value="recipes">
          <RecipesTab
            menu={menu}
            items={items}
            recipes={recipes}
            variants={variants}
            modifiers={modifiers}
            modifierIngredients={modifierIngredients}
            currency={currency}
          />
        </TabsContent>
        {canViewProfit ? (
          <TabsContent value="costing">
            <CostingTab
              menu={menu}
              variants={variants}
              recipes={recipes}
              items={items}
              modifiers={modifiers}
              modifierIngredients={modifierIngredients}
              currency={currency}
            />
          </TabsContent>
        ) : null}
        {canCount ? (
          <TabsContent value="counts">
            <CountsTab counts={counts} timezone={timezone} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
