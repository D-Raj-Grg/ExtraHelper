"use client"

import { CloudOffIcon, RefreshCwIcon } from "lucide-react"
import { useOffline } from "@/components/offline-sync-provider"
import { Button } from "@/components/ui/button"

/** Header pill: shows offline state + queued-write count; click to sync now. */
export function OfflineBadge() {
  const { online, pending, syncNow } = useOffline()
  if (online && pending === 0) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void syncNow()}
      title={online ? "Sync queued changes now" : "You're offline — changes are queued"}
      className={`gap-1.5 rounded-full text-xs ${
        online
          ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
          : "border-red-500/40 text-red-600 dark:text-red-400"
      }`}
    >
      {online ? <RefreshCwIcon className="size-3" /> : <CloudOffIcon className="size-3" />}
      {online ? "Sync" : "Offline"}
      {pending > 0 ? ` · ${pending}` : ""}
    </Button>
  )
}
