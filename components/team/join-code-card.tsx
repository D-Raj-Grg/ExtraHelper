"use client"

import { useEffect, useState, useTransition } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import { generateJoinCode } from "@/app/(app)/team/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RoleOption } from "./types"

const DEFAULT_ROLE = "__default__"

export function JoinCodeCard({ roleOptions }: { roleOptions: RoleOption[] }) {
  const [roleId, setRoleId] = useState(DEFAULT_ROLE)
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  // Clear the "Copied" flag on a timer — cancelled on unmount so it can't fire
  // into an unmounted component.
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const generate = () =>
    startTransition(async () => {
      setCopied(false)
      const res = await generateJoinCode(roleId === DEFAULT_ROLE ? null : roleId)
      if (!res) return
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      setCode(res.code)
      toast.success("Join code generated.")
    })

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      toast.error("Couldn't copy — select the code and copy it manually.")
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Join code</CardTitle>
        <CardDescription>
          Hand someone a code instead of their email. They enter it when signing up, then you approve
          them below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-56">
            <FieldLabel htmlFor="join-role">Role on joining</FieldLabel>
            <Select value={roleId} onValueChange={(v) => setRoleId(String(v ?? DEFAULT_ROLE))}>
              <SelectTrigger id="join-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_ROLE}>Default (waiter)</SelectItem>
                {roleOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button disabled={pending} onClick={generate}>
            {pending ? "Generating…" : code ? "Generate new code" : "Generate code"}
          </Button>
        </div>

        {code ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border bg-muted px-3 py-2 font-mono text-lg font-semibold tracking-widest">
                {code}
              </code>
              <Button type="button" variant="outline" onClick={copy}>
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              They&apos;ll appear below as <span className="font-medium">Pending</span> until you
              approve them.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
