"use client"

import { useState, useTransition } from "react"
import { UserCogIcon } from "lucide-react"
import { transferOwnership } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TransferMember } from "./types"

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  members,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  members: TransferMember[]
}) {
  const [userId, setUserId] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const canTransfer = Boolean(userId) && agreed && !pending

  function reset() {
    setUserId("")
    setAgreed(false)
    setError(null)
  }

  function submit() {
    startTransition(async () => {
      const res = await transferOwnership(userId)
      if (res && "error" in res) {
        setError(res.error)
        return
      }
      reset()
      onOpenChange(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Transfer Ownership</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <UserCogIcon className="size-6" aria-hidden />
            </span>
          </div>

          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There&apos;s no other active member to transfer to. Add a team member on the Users &amp; Roles
              page first, then come back.
            </p>
          ) : (
            <Field>
              <FieldLabel htmlFor="transfer-to">New owner</FieldLabel>
              <Select value={userId} onValueChange={(v) => { setError(null); setUserId(String(v)) }}>
                <SelectTrigger id="transfer-to" className="w-full">
                  <SelectValue placeholder="Select from staff" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.email}
                      {m.roleName ? ` · ${m.roleName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
            <li>A restaurant has exactly one owner at a time.</li>
            <li>Your role changes to Manager once you transfer.</li>
            <li>The new owner can remove you or delete the restaurant.</li>
            <li>You can only transfer to someone already on your team.</li>
            <li>This cannot be reversed — the new owner must transfer it back.</li>
          </ul>

          <Field orientation="horizontal">
            <Checkbox
              id="transfer-consent"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              disabled={members.length === 0 || pending}
            />
            <FieldLabel htmlFor="transfer-consent" className="font-normal">
              I understand and agree to transfer ownership to another team member.
            </FieldLabel>
          </Field>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={!canTransfer}>
            {pending ? "Transferring…" : "Confirm transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
