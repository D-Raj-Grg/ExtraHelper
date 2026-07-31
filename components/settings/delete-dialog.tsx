"use client"

import { useState, useTransition } from "react"
import { Trash2Icon, TriangleAlertIcon } from "lucide-react"
import { requestDeleteRestaurant } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmPhraseDialog } from "./confirm-phrase-dialog"
import { RestaurantHeaderCard, ResourceUsageCard } from "./resource-usage-card"
import type { DangerData } from "./types"

export function DeleteDialog({
  open,
  onOpenChange,
  restaurantName,
  data,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  restaurantName: string
  data: DangerData
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const res = await requestDeleteRestaurant()
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      setError(null)
      setConfirming(false)
      onOpenChange(false)
    })
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) setError(null)
          onOpenChange(v)
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Delete Restaurant</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <RestaurantHeaderCard name={restaurantName} planLabel={data.planLabel} />
            <ResourceUsageCard data={data} />

            <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <TriangleAlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold">This can&apos;t be undone once the grace period ends.</span>
                <span className="text-muted-foreground">
                  The restaurant is scheduled for deletion and everything is permanently removed after a
                  7-day grace period. You can cancel any time before then.
                </span>
              </div>
            </div>

            {error && !confirming ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setError(null)
                setConfirming(true)
              }}
              disabled={pending}
            >
              <Trash2Icon className="size-4" />
              Delete restaurant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmPhraseDialog
        open={confirming}
        onOpenChange={(v) => {
          if (!v) setError(null)
          setConfirming(v)
        }}
        title="Delete this restaurant?"
        description="Everything — orders, bills, menu, tables, customers and stock — is permanently removed after the 7-day grace period. Cancel any time before then to keep it."
        phrase={restaurantName}
        phraseHint="the restaurant name"
        confirmLabel="Delete restaurant"
        pendingLabel="Scheduling…"
        pending={pending}
        error={error}
        onConfirm={submit}
      />
    </>
  )
}
