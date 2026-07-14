"use client"

import Link from "next/link"
import { startCount } from "@/app/(app)/inventory/actions"
import { formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import type { CountRow } from "./types"

const POSTED_PILL =
  "rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400"
const DRAFT_PILL =
  "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"

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
        <ul className="divide-y overflow-hidden rounded-lg border text-sm">
          {counts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/inventory/count/${c.id}`}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50"
              >
                <span className="tabular-nums">{formatDateTime(c.created_at, timezone)}</span>
                <span className={c.posted_at ? POSTED_PILL : DRAFT_PILL}>{c.posted_at ? "Posted" : "Draft"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No counts yet — start one to reconcile your shelves against the system.
        </p>
      )}
    </div>
  )
}
