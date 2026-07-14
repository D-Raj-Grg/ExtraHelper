"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ItemsTab } from "./items-tab"
import { CategoriesTab } from "./categories-tab"
import { ModifiersTab } from "./modifiers-tab"
import { CombosTab } from "./combos-tab"
import { StationsTab } from "./stations-tab"
import type { Category, Combo, Item, Modifier, Station } from "./types"

export function MenuManager({
  currency,
  categories,
  items,
  stations,
  modifiers,
  combos,
}: {
  currency: string
  categories: Category[]
  items: Item[]
  stations: Station[]
  modifiers: Modifier[]
  combos: Combo[]
}) {
  return (
    <Tabs defaultValue="items">
      <TabsList variant="line" className="mb-6 w-full justify-start overflow-x-auto">
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="modifiers">Add-ons</TabsTrigger>
        <TabsTrigger value="combos">Combos</TabsTrigger>
        <TabsTrigger value="stations">Stations</TabsTrigger>
      </TabsList>

      <TabsContent value="items">
        <ItemsTab
          currency={currency}
          categories={categories}
          items={items}
          stations={stations}
          modifiers={modifiers}
        />
      </TabsContent>
      <TabsContent value="categories">
        <CategoriesTab categories={categories} />
      </TabsContent>
      <TabsContent value="modifiers">
        <ModifiersTab modifiers={modifiers} currency={currency} />
      </TabsContent>
      <TabsContent value="combos">
        <CombosTab combos={combos} items={items} currency={currency} />
      </TabsContent>
      <TabsContent value="stations">
        <StationsTab stations={stations} />
      </TabsContent>
    </Tabs>
  )
}
