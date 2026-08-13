"use client"

import { useRef, useState, useTransition } from "react"
import { removeBrandImage, uploadBrandImage } from "@/app/(app)/settings/actions"
import { bakeAsset, type BakeKind } from "@/components/print/bake-image"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CARD_GRID } from "./types"

export function ReceiptTab({
  receipt,
  logoUrl,
  qrUrl,
  qrCaption,
}: {
  receipt: { header: string; footer: string; terms: string }
  logoUrl: string | null
  qrUrl: string | null
  qrCaption: string
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

      <BrandImageCard
        kind="logo"
        url={logoUrl}
        title="Branding"
        description="Logo printed at the top of every receipt, and shown on the storefront. Max 3 MB."
        fileHint="PNG or JPG. A wide, high-contrast mark prints best — fine detail disappears on thermal paper."
        removeConsequence="Receipts will print without a logo from the next ticket onwards."
      />

      <BrandImageCard
        kind="qr"
        url={qrUrl}
        title="Payment QR"
        description="Printed near the bottom of every receipt so a guest can scan and pay from the slip. Max 3 MB."
        fileHint="Upload the QR image from your payment provider. Crop out any surrounding poster art — the code itself should fill the picture."
        removeConsequence="Guests will no longer be able to scan and pay from a printed receipt."
      >
        <Field>
          <FieldLabel htmlFor="qrCaption">Caption above the QR</FieldLabel>
          <Input
            id="qrCaption"
            name="qrCaption"
            defaultValue={qrCaption}
            placeholder="Scan to pay"
            maxLength={40}
          />
          <FieldDescription>Saved with the Save button below, not with the upload.</FieldDescription>
        </Field>
      </BrandImageCard>
    </div>
  )
}

/** 58mm / 76mm / 80mm rolls, by the dot count each one prints. */
const ROLL_LABEL: Record<number, string> = { 384: "58mm", 416: "76mm", 576: "80mm" }

/**
 * Uploads post on their own — they can't be a nested <form> inside the settings
 * form, so the action is called directly from a transition.
 *
 * The image is converted to printer bitmaps *here*, before the upload, because
 * this browser is the only part of the system with a canvas: the Android app
 * and the headless print agent both fetch finished bytes and put them straight
 * on the wire.
 */
function BrandImageCard({
  kind,
  url,
  title,
  description,
  fileHint,
  removeConsequence,
  children,
}: {
  kind: BakeKind
  url: string | null
  title: string
  description: string
  fileHint: string
  removeConsequence: string
  children?: React.ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{
    error?: string
    ok?: boolean
    warning?: string
  } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const noun = kind === "logo" ? "Logo" : "QR code"

  const upload = () => {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      setResult({ error: "Choose an image file." })
      return
    }

    startTransition(async () => {
      let baked
      try {
        baked = await bakeAsset(file, kind)
      } catch {
        setResult({ error: "That file could not be read as an image. Try a PNG or JPG." })
        return
      }

      // A payment QR that prints but will not scan is a guest at the till with
      // a phone that cannot pay, and nobody finds out until service. Refuse it
      // outright when no paper width could read it back.
      if (kind === "qr" && baked.unscannable.length === 3) {
        setResult({
          error:
            "This QR stopped scanning once converted to black and white. Try a sharper, higher-contrast image, cropped tight to the code.",
        })
        return
      }

      const fd = new FormData()
      fd.set("kind", kind)
      fd.set("file", file)
      fd.set("variants", JSON.stringify(baked.variants))
      const res = await uploadBrandImage(undefined, fd)
      if (res && "error" in res) {
        setResult({ error: res.error })
        return
      }
      setResult({
        ok: true,
        warning: baked.unscannable.length
          ? `It may not scan on ${baked.unscannable.map((w) => ROLL_LABEL[w] ?? `${w} dots`).join(" and ")} paper — test a print before service.`
          : undefined,
      })
    })
  }

  const remove = () => {
    const fd = new FormData()
    fd.set("kind", kind)
    startTransition(async () => {
      const res = await removeBrandImage(undefined, fd)
      setResult(res && "error" in res ? { error: res.error } : { ok: true })
      if (inputRef.current) inputRef.current.value = ""
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={kind === "logo" ? "Current restaurant logo" : "Current payment QR code"}
                className="size-16 shrink-0 rounded-md border object-contain"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                None
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {url
                ? "Uploading a new file replaces this one."
                : `No ${noun.toLowerCase()} uploaded yet.`}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${kind}-file`}>{noun} file</FieldLabel>
            <Input
              id={`${kind}-file`}
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={() => setResult(null)}
            />
            <FieldDescription>{fileHint}</FieldDescription>
          </Field>
          {children}
          {result?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          ) : null}
          {result?.ok ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              {noun} updated.
            </p>
          ) : null}
          {result?.warning ? (
            <p className="text-sm text-amber-600 dark:text-amber-400" role="status">
              {result.warning}
            </p>
          ) : null}
          <Field orientation="horizontal">
            <Button type="button" variant="outline" onClick={upload} disabled={pending}>
              {pending ? "Preparing…" : `Upload ${noun.toLowerCase()}`}
            </Button>
            {url ? (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger
                  render={
                    <Button type="button" variant="ghost" disabled={pending}>
                      Remove
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove the {noun.toLowerCase()}?</AlertDialogTitle>
                    <AlertDialogDescription>{removeConsequence}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        setConfirmOpen(false)
                        remove()
                      }}
                    >
                      Remove {noun.toLowerCase()}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
