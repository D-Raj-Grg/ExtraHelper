"use client"

import { useState, useTransition } from "react"
import { CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, WandSparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { createInviteLogin, setMemberPassword } from "@/app/(app)/team/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { Member } from "./types"

// No look-alikes (0/O, 1/l/I) — the owner reads this out or writes it down.
const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
const DIGITS = "23456789"

function generatePassword(): string {
  const pick = (set: string, n: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => set[v % set.length]).join("")
  return `${pick(LETTERS, 4)}-${pick(DIGITS, 4)}-${pick(LETTERS, 4)}`
}

/**
 * Owner sets a password for a member who forgot theirs, or — for an invite with
 * no account yet — creates their login outright. Either way the owner hands the
 * password over in person; nothing is emailed.
 */
export function PasswordDialog({ member, disabled }: { member: Member; disabled: boolean }) {
  const isInvite = !member.user_id
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const inputId = `pw-${member.user_id ?? member.email}`

  function reset() {
    setPassword("")
    setVisible(false)
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = isInvite
        ? await createInviteLogin(member.email, password)
        : await setMemberPassword(member.user_id as string, password)
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      toast.success(
        isInvite
          ? `Login created for ${member.email}. They can sign in now.`
          : `Password updated for ${member.email}.`,
      )
      reset()
      setOpen(false)
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      toast.success("Password copied.")
    } catch {
      toast.error("Couldn't copy — select the password and copy it by hand.")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" disabled={disabled}>
            <KeyRoundIcon className="size-4" aria-hidden />
            {isInvite ? "Create login" : "Set password"}
            <span className="sr-only"> for {member.email}</span>
          </Button>
        }
      />
      <DialogContent size="md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{isInvite ? "Create login" : "Set a new password"}</DialogTitle>
            <DialogDescription className="break-all">{member.email}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={inputId}>{isInvite ? "Password" : "New password"}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={inputId}
                  type={visible ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setError(null)
                    setPassword(e.target.value)
                  }}
                  autoComplete="new-password"
                  className="font-mono"
                  minLength={8}
                  maxLength={72}
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setVisible((v) => !v)}
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copy}
                  disabled={!password}
                  aria-label="Copy password"
                >
                  <CopyIcon aria-hidden />
                </Button>
              </div>
              <FieldDescription>At least 8 characters, with letters and numbers.</FieldDescription>
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              onClick={() => {
                setError(null)
                setPassword(generatePassword())
                setVisible(true)
              }}
            >
              <WandSparklesIcon className="size-4" aria-hidden />
              Generate one
            </Button>
            <p className="text-sm text-muted-foreground">
              {isInvite
                ? "We create their account and add them to the team as active. Nothing is emailed — tell them the password in person."
                : "Their old password stops working right away. Nothing is emailed — tell them the new one in person."}
            </p>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || password.length < 8}>
              {pending ? "Saving…" : isInvite ? "Create login" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
