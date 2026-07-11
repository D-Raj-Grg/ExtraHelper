"use client"

import { CloudOffIcon, RefreshCwIcon } from "lucide-react"
import { useOffline } from "@/components/offline-sync-provider"

/** Header pill: shows offline state + queued-write count; click to sync now. */
export function OfflineBadge() {
  const { online, pending, syncNow } = useOffline()
  if (online && pending === 0) return null

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={online ? "Sync queued changes now" : "You're offline — changes are queued"}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
        online
          ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
          : "border-red-500/40 text-red-600 dark:text-red-400"
      }`}
    >
      {online ? <RefreshCwIcon className="size-3" /> : <CloudOffIcon className="size-3" />}
      {online ? "Sync" : "Offline"}
      {pending > 0 ? ` · ${pending}` : ""}
    </button>
  )
}
