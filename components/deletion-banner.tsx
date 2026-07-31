"use client"

import { useState, useTransition } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { cancelDeleteRestaurant } from "@/app/(app)/settings/actions"
import { formatDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"

/** Whole days left in the grace window, floored, never negative. */
function daysLeft(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * App-wide bar shown on every staff page while the restaurant sits in its
 * deletion grace window — the settings tab is the wrong place to learn your
 * data disappears on Tuesday. Only the owner can cancel; everyone else gets
 * the warning without a dead button.
 */
export function DeletionBanner({
  scheduledAt,
  timezone,
  isOwner,
}: {
  scheduledAt: string
  timezone: string
  isOwner: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const days = daysLeft(scheduledAt)

  function cancel() {
    startTransition(async () => {
      const res = await cancelDeleteRestaurant()
      setError(res && "error" in res ? res.error : null)
    })
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:gap-3"
    >
      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">
          Scheduled for deletion — {days === 0 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`} left.
        </span>{" "}
        <span className="text-muted-foreground">
          Everything is permanently removed on {formatDateTime(scheduledAt, timezone)}.
          {error ? ` ${error}` : ""}
        </span>
      </span>
      {isOwner ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={cancel}
          disabled={pending}
        >
          {pending ? "Cancelling…" : "Cancel deletion"}
        </Button>
      ) : null}
    </div>
  )
}
