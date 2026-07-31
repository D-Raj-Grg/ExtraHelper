"use client"

import { useState, useTransition } from "react"
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { resetRestaurant } from "@/app/(app)/settings/actions"
import { RESET_DOMAINS, RESET_EVERYTHING } from "@/lib/danger-constants"
import { ChoiceChip } from "@/components/pos/choice-chip"
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

export function ResetDialog({
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [everything, setEverything] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const count = everything ? RESET_DOMAINS.length : selected.size
  const canReset = count > 0 && !pending

  function toggle(key: string) {
    setError(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function reset() {
    setSelected(new Set())
    setEverything(false)
    setConfirming(false)
    setError(null)
  }

  function submit() {
    const domains = everything ? [RESET_EVERYTHING] : [...selected]
    startTransition(async () => {
      const res = await resetRestaurant(domains)
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      reset()
      onOpenChange(false)
    })
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Reset Restaurant</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <RestaurantHeaderCard name={restaurantName} planLabel={data.planLabel} />
          <ResourceUsageCard data={data} />

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">
              What to reset <span className="text-destructive">*</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RESET_DOMAINS.map((d) => (
                <ChoiceChip
                  key={d.key}
                  type="checkbox"
                  name="reset-domain"
                  checked={everything || selected.has(d.key)}
                  disabled={everything || pending}
                  onSelect={() => toggle(d.key)}
                  label={d.label}
                  detail={d.detail}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            Or, reset the whole restaurant
            <span className="h-px flex-1 bg-border" />
          </div>

          <ChoiceChip
            type="checkbox"
            name="reset-everything"
            checked={everything}
            disabled={pending}
            onSelect={() => {
              setError(null)
              setEverything((v) => !v)
            }}
            className="min-h-14"
            label="Reset Everything"
            detail="Clear all operational data at once (keeps this restaurant, its settings and you)"
          />

          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Once completed, this cannot be reversed.
          </p>

          {error && !confirming ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {count} of {RESET_DOMAINS.length} selected
          </span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canReset}
              onClick={() => {
                setError(null)
                setConfirming(true)
              }}
            >
              <RotateCcwIcon className="size-4" />
              Reset it!
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmPhraseDialog
      open={confirming}
      onOpenChange={(v) => {
        if (!v) setError(null)
        setConfirming(v)
      }}
      title={`Reset ${count} area${count === 1 ? "" : "s"}?`}
      description={
        everything
          ? "Every order, bill, menu item, table, customer and stock record is permanently deleted. This restaurant and your ownership stay. This cannot be reversed."
          : "The selected data is permanently deleted and cannot be reversed."
      }
      phrase={restaurantName}
      phraseHint="the restaurant name"
      confirmLabel="Reset now"
      pendingLabel="Resetting…"
      pending={pending}
      error={error}
      onConfirm={submit}
    />
    </>
  )
}
