"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Trash2Icon } from "lucide-react"
import { deleteAccount } from "@/app/auth/actions"
import { ConfirmPhraseDialog } from "@/components/settings/confirm-phrase-dialog"
import { Button } from "@/components/ui/button"

/**
 * "Delete account" — the user-scoped counterpart to the restaurant-scoped
 * Dangerous Area in `/settings`. Reuses `ConfirmPhraseDialog` so retyping to
 * unlock reads the same everywhere; the phrase is the email, because this is
 * the person and not the restaurant.
 *
 * Rendered in two places, hence `variant`: a full section on `/profile`, and a
 * single line on `/onboarding` for the user with no tenant, who cannot reach
 * `/profile` at all.
 */
export function DeleteAccountSection({
  email,
  variant = "section",
}: {
  email: string
  variant?: "section" | "compact"
}) {
  // A phone-only account has no email, and `ConfirmPhraseDialog` matches on
  // equality — an empty phrase would equal an empty box and arm the button
  // before the user typed anything. Fall back to a word they have to type.
  const phrase = email.trim() || "DELETE"
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      // Success redirects: the action returns nothing and the router navigates,
      // so only a refusal ever comes back here.
      const res = await deleteAccount()
      if (!res) return
      setError(res.error)
      setCode(res.code ?? null)
    })
  }

  const dialog = (
    <ConfirmPhraseDialog
      open={open}
      // Deliberately does NOT clear the error on close. A refusal is the whole
      // point of closing — the P0001 way-out link lives outside the dialog, so
      // wiping the error here would make it unreachable. Reopening clears it.
      onOpenChange={setOpen}
      title="Delete your account?"
      description={
        <>
          This removes your profile, handle, avatar, restaurant memberships and preferences, and signs
          you out everywhere. It cannot be undone. Orders, bills and cash records stay with the
          restaurant — they simply stop naming you.
        </>
      }
      phrase={phrase}
      phraseHint={email.trim() ? "your email" : undefined}
      confirmLabel="Delete account"
      pendingLabel="Deleting…"
      pending={pending}
      error={error}
      onConfirm={submit}
    />
  )

  // P0001 = sole owner. The message says to hand the restaurant over or delete
  // it; both live in the Dangerous Area, so point at it rather than leaving the
  // user to find it.
  const ownerWayOut =
    code === "P0001" ? (
      <Link href="/settings" className="text-sm font-medium underline underline-offset-4">
        Manage restaurant ownership
      </Link>
    ) : null

  if (variant === "compact") {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={() => {
            setError(null)
            setCode(null)
            setOpen(true)
          }}
        >
          Delete my account
        </Button>
        {error && !open ? (
          <>
            <p className="text-center text-sm text-destructive" role="alert">
              {error}
            </p>
            {ownerWayOut}
          </>
        ) : null}
        {dialog}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-destructive/40 p-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-destructive">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Removes your profile, handle, avatar, restaurant memberships and preferences. Orders, bills
          and cash records stay with the restaurant — they keep the history without your name on it.
          This cannot be undone.
        </p>
      </div>

      {error && !open ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          {ownerWayOut}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            setError(null)
            setCode(null)
            setOpen(true)
          }}
        >
          <Trash2Icon className="size-4" />
          Delete account
        </Button>
      </div>

      {dialog}
    </section>
  )
}
