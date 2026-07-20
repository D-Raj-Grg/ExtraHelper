"use client"

import Link from "next/link"
import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react"
import { startCount } from "@/app/(app)/inventory/actions"
import { formatDateTime } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { CountRow } from "./types"

export function CountsTab({ counts, timezone }: { counts: CountRow[]; timezone: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Stock counts</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Snapshot on-hand, enter what you actually counted, then post to reconcile. The gap between counted and
            expected is <span className="font-medium text-foreground">variance</span> (shrinkage/wastage).
          </p>
        </div>
        <form action={startCount}>
          <Button type="submit">Start stock count</Button>
        </form>
      </div>

      {counts.length > 0 ? (
        <Card className="divide-y overflow-hidden p-0 text-sm">
          {counts.map((c) => (
            <Link
              key={c.id}
              href={`/inventory/count/${c.id}`}
              className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50"
            >
              <span className="tabular-nums">{formatDateTime(c.created_at, timezone)}</span>
              {c.posted_at ? (
                <Badge className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-3.5" /> Posted
                </Badge>
              ) : (
                <Badge className="gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <CircleDashedIcon className="size-3.5" /> Draft
                </Badge>
              )}
            </Link>
          ))}
        </Card>
      ) : (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          No counts yet — start one to reconcile your shelves against the system.
        </Card>
      )}
    </div>
  )
}
