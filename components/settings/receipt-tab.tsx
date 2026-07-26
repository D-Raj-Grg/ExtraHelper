"use client"

import { useRef, useState, useTransition } from "react"
import { uploadTenantLogo } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CARD_GRID } from "./types"

export function ReceiptTab({
  receipt,
  logoUrl,
}: {
  receipt: { header: string; footer: string; terms: string }
  logoUrl: string | null
}) {
  return (
    <div className={CARD_GRID}>
      <Card>
        <CardHeader>
          <CardTitle>Receipt template</CardTitle>
          <CardDescription>What prints above and below the items on every receipt.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="receiptHeader">Header</FieldLabel>
              <Input
                id="receiptHeader"
                name="receiptHeader"
                defaultValue={receipt.header}
                placeholder="Restaurant name / tagline"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="receiptFooter">Footer</FieldLabel>
              <Textarea
                id="receiptFooter"
                name="receiptFooter"
                defaultValue={receipt.footer}
                placeholder="Thank you! Visit again."
                rows={2}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="receiptTerms">Terms / notes</FieldLabel>
              <Textarea
                id="receiptTerms"
                name="receiptTerms"
                defaultValue={receipt.terms}
                placeholder="No refunds on food. Prices incl. taxes where applicable."
                rows={3}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <LogoCard logoUrl={logoUrl} />
    </div>
  )
}

/**
 * Logo upload posts on its own — it can't be a nested <form> inside the settings
 * form, so it calls the action directly from a transition.
 */
function LogoCard({ logoUrl }: { logoUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ error?: string; ok?: boolean } | null>(null)

  const upload = () => {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setResult({ error: "Choose an image file." })
      return
    }
    const fd = new FormData()
    fd.set("logo", file)
    startTransition(async () => {
      const res = await uploadTenantLogo(undefined, fd)
      setResult(res && "error" in res ? { error: res.error } : { ok: true })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Logo shown on receipts and the storefront. Max 3 MB.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Current restaurant logo"
                className="size-16 shrink-0 rounded-md border object-contain"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                None
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {logoUrl ? "Uploading a new file replaces this one." : "No logo uploaded yet."}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="logo">Logo file</FieldLabel>
            <Input
              id="logo"
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={() => setResult(null)}
            />
            <FieldDescription>PNG or JPG, square works best.</FieldDescription>
          </Field>
          {result?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          ) : null}
          {result?.ok ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              Logo updated.
            </p>
          ) : null}
          <Field>
            <Button type="button" variant="outline" onClick={upload} disabled={pending}>
              {pending ? "Uploading…" : "Upload logo"}
            </Button>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
