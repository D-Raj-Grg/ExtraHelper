"use client"

import { CheckCircle2Icon, ChefHatIcon, ClipboardListIcon, LayoutGridIcon } from "lucide-react"

import { SegmentedControl, type SegmentedItem } from "@/components/pos/segmented-control"

export type PosTab = "orders" | "table" | "kot" | "completed"

const TABS: { key: PosTab; label: string; icon: SegmentedItem<PosTab>["icon"] }[] = [
  { key: "orders", label: "Orders", icon: ClipboardListIcon },
  { key: "table", label: "Table", icon: LayoutGridIcon },
  { key: "kot", label: "KOT", icon: ChefHatIcon },
  { key: "completed", label: "Completed", icon: CheckCircle2Icon },
]

/**
 * The POS panes as one segmented control.
 *
 * `counts` is partial on purpose: a badge here means "this many things want
 * you", which is true of open orders and live tickets and false of a completed
 * count that only ever climbs. Omitting the key says that; passing 0 would be a
 * number pretending to be information.
 */
export function PosTabs({
  value,
  onChange,
  counts,
}: {
  value: PosTab
  onChange: (tab: PosTab) => void
  counts: Partial<Record<PosTab, number>>
}) {
  return (
    <SegmentedControl
      ariaLabel="POS view"
      value={value}
      onChange={onChange}
      items={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
    />
  )
}
