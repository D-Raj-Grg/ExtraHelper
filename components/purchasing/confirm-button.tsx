"use client"

import { useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/**
 * One confirm, used everywhere on this screen.
 *
 * Controlled on purpose: `AlertDialogAction` is a plain button here and does
 * not close the dialog itself, so the handler has to. The trigger takes
 * base-ui's `render` prop, not `asChild`.
 *
 * `blocked` turns the whole thing into an explanation instead of a confirm —
 * the case where the action is impossible and the user deserves a sentence
 * rather than a disabled button with a tooltip they can't reach on a phone.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = "outline",
  destructive = false,
  disabled = false,
  blocked = false,
  blockedAction,
}: {
  label: ReactNode
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  variant?: "outline" | "ghost" | "secondary" | "destructive"
  destructive?: boolean
  disabled?: boolean
  /** When true the dialog explains why nothing can happen and offers no confirm. */
  blocked?: boolean
  /** Optional alternative offered instead of the blocked action. */
  blockedAction?: { label: string; onClick: () => void }
}) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant={variant}
            disabled={disabled}
            className={destructive && !blocked ? "text-destructive" : undefined}
          >
            {label}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {blocked ? (
            blockedAction ? (
              <AlertDialogAction
                onClick={() => {
                  setOpen(false)
                  blockedAction.onClick()
                }}
              >
                {blockedAction.label}
              </AlertDialogAction>
            ) : null
          ) : (
            <AlertDialogAction
              variant={destructive ? "destructive" : undefined}
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
