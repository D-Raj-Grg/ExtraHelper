"use client"

import { useId, useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Last-step confirmation for an irreversible Dangerous Area action: the caller
 * must retype an exact phrase before the button unlocks. One component for
 * reset / transfer / delete so all three read the same and nothing can be
 * fired by muscle memory. Matching is case-insensitive on trimmed input — the
 * point is deliberate typing, not a spelling test.
 */
export function ConfirmPhraseDialog({
  open,
  onOpenChange,
  title,
  description,
  phrase,
  phraseHint,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: React.ReactNode
  /** The exact text the owner must retype to unlock the action. */
  phrase: string
  /** What to call the phrase in the label, e.g. "restaurant name". */
  phraseHint?: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  error: string | null
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  const inputId = useId()
  const matches = typed.trim().toLowerCase() === phrase.trim().toLowerCase()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        // Clear on close so reopening never starts pre-armed.
        if (!v) setTyped("")
        onOpenChange(v)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlertIcon aria-hidden />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor={inputId}>
            Type <span className="font-semibold text-foreground">{phrase}</span>
            {phraseHint ? <span className="text-muted-foreground"> ({phraseHint})</span> : null} to confirm
          </FieldLabel>
          <Input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && !pending) onConfirm()
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={pending}
            aria-invalid={typed.length > 0 && !matches}
            placeholder={phrase}
          />
        </Field>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || pending}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
