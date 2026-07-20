"use client"

import { useState, useTransition } from "react"
import {
  ChevronRightIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserCogIcon,
} from "lucide-react"
import { cancelDeleteRestaurant } from "@/app/(app)/settings/actions"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ResetDialog } from "./reset-dialog"
import { TransferOwnershipDialog } from "./transfer-ownership-dialog"
import { DeleteDialog } from "./delete-dialog"
import type { DangerData } from "./types"

type OpenDialog = "reset" | "transfer" | "delete" | null

function ActionCard({
  icon: Icon,
  title,
  subtitle,
  destructive,
  onClick,
}: {
  icon: typeof RotateCcwIcon
  title: string
  subtitle: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-lg border p-4 text-left transition-colors motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        destructive
          ? "border-destructive/40 hover:bg-destructive/5"
          : "hover:bg-muted/50",
      )}
    >
      <Icon className={cn("size-6 shrink-0", destructive ? "text-destructive" : "text-foreground")} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("font-semibold", destructive && "text-destructive")}>{title}</span>
        <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRightIcon className={cn("size-5 shrink-0", destructive ? "text-destructive" : "text-muted-foreground")} aria-hidden />
    </button>
  )
}

export function DangerTab({
  restaurantName,
  data,
}: {
  restaurantName: string
  data: DangerData
}) {
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scheduled = data.deletionScheduledAt

  function cancelDeletion() {
    startTransition(async () => {
      const res = await cancelDeleteRestaurant()
      setError(res && "error" in res ? res.error : null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-destructive">Dangerous Area</h2>
        <p className="text-sm text-muted-foreground">
          These actions affect the whole restaurant. Owner only.
        </p>
      </div>

      {scheduled ? (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center">
          <TriangleAlertIcon className="size-5 shrink-0 text-destructive" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold text-destructive">Scheduled for deletion</span>
            <span className="text-sm text-muted-foreground">
              Everything is permanently removed on {formatDateTime(scheduled)}. Cancel before then to keep the
              restaurant.
            </span>
          </div>
          <Button type="button" variant="outline" onClick={cancelDeletion} disabled={pending}>
            {pending ? "Cancelling…" : "Cancel deletion"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <ActionCard
          icon={RotateCcwIcon}
          title="Reset Restaurant"
          subtitle="Wipe data to start fresh"
          onClick={() => setDialog("reset")}
        />
        <ActionCard
          icon={UserCogIcon}
          title="Transfer Ownership"
          subtitle="Hand this restaurant to a teammate"
          onClick={() => setDialog("transfer")}
        />
        {!scheduled ? (
          <ActionCard
            icon={Trash2Icon}
            title="Delete Restaurant"
            subtitle="Remove the whole restaurant"
            destructive
            onClick={() => setDialog("delete")}
          />
        ) : null}
      </div>

      <ResetDialog
        open={dialog === "reset"}
        onOpenChange={(v) => setDialog(v ? "reset" : null)}
        restaurantName={restaurantName}
        data={data}
      />
      <TransferOwnershipDialog
        open={dialog === "transfer"}
        onOpenChange={(v) => setDialog(v ? "transfer" : null)}
        members={data.members}
      />
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(v) => setDialog(v ? "delete" : null)}
        restaurantName={restaurantName}
        data={data}
      />
    </div>
  )
}
