"use client"

import { useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StockTab } from "./stock-tab"
import { RecipesTab } from "./recipes-tab"
import { CountsTab } from "./counts-tab"
import type { CostRow, CountRow, Item, MenuOpt, Recipe } from "./types"

export function InventoryManager({
  currency,
  timezone,
  items,
  menu,
  recipes,
  costHistory,
  counts,
  canCount,
}: {
  currency: string
  timezone: string
  items: Item[]
  menu: MenuOpt[]
  recipes: Recipe[]
  costHistory: CostRow[]
  counts: CountRow[]
  canCount: boolean
}) {
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
      <Tabs defaultValue="stock">
        <TabsList variant="line" className="mb-6 w-full justify-start overflow-x-auto">
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="recipes">Recipes</TabsTrigger>
          {canCount ? <TabsTrigger value="counts">Stock counts</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="stock">
          <StockTab currency={currency} timezone={timezone} items={items} historyByItem={historyByItem} />
        </TabsContent>
        <TabsContent value="recipes">
          <RecipesTab menu={menu} items={items} recipes={recipes} />
        </TabsContent>
        {canCount ? (
          <TabsContent value="counts">
            <CountsTab counts={counts} timezone={timezone} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
