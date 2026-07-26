"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { toggleItem86 } from "@/app/(app)/menu/actions"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

type Item = { id: string; name: string; is_86: boolean }

/**
 * Quick 86 (out-of-stock) toggles for the kitchen, on the KDS screen. Kitchen
 * staff can 86 an item without leaving the board; the change propagates live to
 * POS/ordering surfaces via the menu_items realtime publication.
 */
export function EightySixPanel({ items, tenantId }: { items: Item[]; tenantId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  // Reflect 86 toggles made elsewhere (other terminals) in real time.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`kds86:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `tenant_id=eq.${tenantId}` },
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tenantId, router])

  const eighty6ed = items.filter((i) => i.is_86)

  return (
    <div className="rounded-lg border bg-card/50 p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-muted-foreground">
          86 board
          {eighty6ed.length > 0 ? (
            <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">
              {eighty6ed.length} out
            </span>
          ) : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Manage 86"}
        </Button>
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.length === 0 ? (
            <span className="text-muted-foreground">No items.</span>
          ) : (
            items.map((i) => (
              <Button
                key={i.id}
                size="sm"
                variant={i.is_86 ? "destructive" : "outline"}
                disabled={pending}
                className="rounded-full"
                onClick={() =>
                  startTransition(async () => {
                    const res = await toggleItem86(i.id, !i.is_86)
                    if (res && "error" in res) toast.error(res.error)
                  })
                }
              >
                {i.name}
                {i.is_86 ? " · 86'd" : ""}
              </Button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
