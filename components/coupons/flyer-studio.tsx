"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  ImageUpIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  Share2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  deleteFlyerDesign,
  getBatchCodes,
  markCouponShared,
  saveFlyerDesign,
  setBatchActive,
} from "@/app/(app)/coupons/actions"
import { couponEndDay, couponUrl, couponValueLabel, type CouponBatchRow } from "@/lib/coupon-constants"
import { toCsv } from "@/lib/csv"
import {
  DEFAULT_PLACEMENT,
  flyerPayload,
  isLocalOrigin,
  placementKey,
  readPlacement,
  type FlyerPlacement,
} from "@/lib/flyer"
import { renderFlyerImage } from "@/lib/flyer-image"
import { buildFlyerPdf, type FlyerTemplate } from "@/lib/flyer-pdf"
import { shareFiles, whatsappLink } from "@/lib/flyer-share"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DesignGallery } from "@/components/coupons/design-gallery"
import { FlyerEditor } from "@/components/coupons/flyer-editor"
import { RunForm } from "@/components/coupons/run-form"
import { useOrigin } from "@/components/qr-card"

type Template = FlyerTemplate & { name: string; size: number; url: string }

/** A saved flyer design, with a signed link to its picture. */
export type StudioDesign = {
  id: string
  name: string
  url: string
  width: number
  height: number
  placement: FlyerPlacement
  mode: "url" | "code"
  linkBase: string | null
}
/** One code of the selected run, with whether it has been shared and redeemed. */
export type StudioCode = { code: string; redeemed: boolean; shared: boolean }
type Code = StudioCode
type CodeFilter = "all" | "free" | "shared" | "redeemed"

const PAGE = 20

const ACCEPTED = ["image/jpeg", "image/png"]

function download(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flyers"

/** Read a template file into bytes + pixel size; null (and a toast) when it isn't usable. */
async function loadTemplate(file: File): Promise<Template | null> {
  if (!ACCEPTED.includes(file.type)) {
    toast.error("Use a JPEG or PNG image.")
    return null
  }
  const url = URL.createObjectURL(file)
  const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
  if (!size) {
    URL.revokeObjectURL(url)
    toast.error("That image couldn't be read.")
    return null
  }
  return {
    bytes: await file.arrayBuffer(),
    type: file.type,
    width: size.w,
    height: size.h,
    name: file.name,
    size: file.size,
    url,
  }
}

export function FlyerStudio({
  batches,
  loadError,
  tenantName,
  slug,
  currency,
  timezone,
  canManage,
  designs,
  initialBatchId,
  initialDesignId,
  initialCodes,
}: {
  batches: CouponBatchRow[]
  loadError: string | null
  tenantName: string
  slug: string
  currency: string
  timezone: string
  canManage: boolean
  designs: StudioDesign[]
  initialBatchId: string | null
  initialDesignId: string | null
  initialCodes: Code[]
}) {
  const router = useRouter()
  const origin = useOrigin()

  const [batchId, setBatchId] = useState<string | null>(initialBatchId)
  const [codes, setCodes] = useState<Code[]>(initialCodes)
  const [template, setTemplate] = useState<Template | null>(null)
  const [placement, setPlacement] = useState<FlyerPlacement>(DEFAULT_PLACEMENT)
  const [mode, setMode] = useState<"url" | "code">("code")
  // The address the QR links to. null = this page's own address; typed by the
  // owner when they are working on localhost or a preview deployment.
  const [baseInput, setBaseInput] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [loadingCodes, startLoadCodes] = useTransition()
  const [pauseTarget, setPauseTarget] = useState<CouponBatchRow | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)
  const [filter, setFilter] = useState<CodeFilter>("free")
  const [shown, setShown] = useState(PAGE)
  const [phone, setPhone] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)
  // The saved design in use, its name, whether it differs from what is saved,
  // and the picture picked this session (only that is uploaded on Save).
  const [designId, setDesignId] = useState<string | null>(null)
  const [designName, setDesignName] = useState("")
  const [dirty, setDirty] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [loadingDesign, setLoadingDesign] = useState(false)
  const [saving, startSaving] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  // The new-run / design popup. `step` is where it is; `editing` is true when it
  // edits the selected run rather than creating one.
  const [wizard, setWizard] = useState<{ step: "details" | "design"; editing: boolean } | null>(null)

  const batch = batches.find((b) => b.id === batchId) ?? null
  const base = (baseInput ?? origin).trim().replace(/\/+$/, "")
  const makeUrl = (code: string) => (slug && base ? couponUrl(base, slug, code) : code)
  const payload = (code: string) => flyerPayload(mode, code, makeUrl)
  const sample = codes[0]?.code ?? "SEKU-A1B2C3"
  const exporting = progress !== null
  // A flyer must not link somewhere a guest's phone can't open.
  const baseProblem: string | null =
    mode !== "url" || slug === ""
      ? null
      : !/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(base) && !isLocalOrigin(base)
        ? "Enter the full address, like https://your-site.com"
        : isLocalOrigin(base)
          ? "That address only works on this computer. Enter your live site's address."
          : null
  const blocked = baseProblem !== null
  const canExport = template !== null && batch !== null && codes.length > 0 && !exporting && !blocked

  // What goes in the chat next to the picture.
  function message(code: string): string {
    if (!batch) return code
    const till = batch.valid_to ? ` Valid till ${couponEndDay(batch.valid_to, timezone)}.` : ""
    const link = mode === "url" && slug && base ? `\n${makeUrl(code)}` : ""
    return `${tenantName}: ${couponValueLabel(batch.type, batch.value, currency)}. Show this code at the counter: ${code}.${till}${link}`
  }

  const counts = {
    free: codes.filter((c) => !c.shared && !c.redeemed).length,
    shared: codes.filter((c) => c.shared && !c.redeemed).length,
    redeemed: codes.filter((c) => c.redeemed).length,
  }
  const matches = (c: Code) =>
    filter === "all" ? true : filter === "free" ? !c.shared && !c.redeemed : filter === "shared" ? c.shared && !c.redeemed : c.redeemed
  const list = codes.filter(matches)
  const nextFree = codes.find((c) => !c.shared && !c.redeemed) ?? null

  /** Bring a saved design back: its picture, placement and QR settings. */
  async function loadDesign(d: StudioDesign) {
    setLoadingDesign(true)
    try {
      // Fetched into a blob so the canvas that draws shared pictures is not tainted by a foreign origin.
      const res = await fetch(d.url)
      if (!res.ok) throw new Error("The saved template couldn't be loaded.")
      const blob = await res.blob()
      const t = await loadTemplate(new File([blob], d.name, { type: blob.type || "image/jpeg" }))
      if (!t) return
      setTemplate((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return t
      })
      setPlacement(d.placement)
      setMode(d.mode)
      setBaseInput(d.linkBase)
      setDesignId(d.id)
      setDesignName(d.name)
      setPendingFile(null)
      setDirty(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The saved template couldn't be loaded.")
    } finally {
      setLoadingDesign(false)
    }
  }

  // The newest run opens with its design already loaded.
  useEffect(() => {
    const d = designs.find((x) => x.id === initialDesignId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetches an external file once on mount
    if (d) void loadDesign(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [])

  function saveDesign(after?: () => void, asNew = false) {
    if (!template) return
    const fd = new FormData()
    if (designId && !asNew) fd.set("id", designId)
    fd.set("name", asNew && designId ? `${designName} copy` : designName)
    if (batchId) fd.set("batch", batchId)
    fd.set("mode", mode)
    fd.set("linkBase", base)
    fd.set("width", String(template.width))
    fd.set("height", String(template.height))
    fd.set("placement", JSON.stringify(placement))
    if (pendingFile || !designId || asNew) fd.set("template", pendingFile ?? new File([template.bytes], template.name, { type: template.type }))
    startSaving(async () => {
      const res = await saveFlyerDesign(fd)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      setDesignId(res.id)
      setPendingFile(null)
      setDirty(false)
      toast.success(batch ? `Design saved for ${batch.name}.` : "Design saved.")
      router.refresh()
      after?.()
    })
  }

  function removeDesign() {
    if (!designId) return
    startSaving(async () => {
      const res = await deleteFlyerDesign(designId)
      if ("error" in res) toast.error(res.error)
      else {
        toast.success("Design deleted. Your runs are untouched.")
        setDesignId(null)
        setDesignName("")
        setDirty(false)
        router.refresh()
      }
      setDeleteOpen(false)
    })
  }

  /** Back to the gallery: drop the loaded picture so another design or a new upload can be chosen. */
  function leaveDesign() {
    if (template) URL.revokeObjectURL(template.url)
    setTemplate(null)
    setDesignId(null)
    setDesignName("")
    setPendingFile(null)
    setDirty(false)
  }

  /** Open the popup on a run (selecting it first). */
  function openWizard(run: CouponBatchRow, step: "details" | "design") {
    if (run.id !== batchId) pick(run.id)
    setWizard({ step, editing: true })
  }

  function pick(id: string) {
    setBatchId(id)
    // A run opens with the design it was saved with.
    const linked = batches.find((b) => b.id === id)?.design_id
    const d = linked ? designs.find((x) => x.id === linked) : undefined
    if (d) {
      if (d.id !== designId) void loadDesign(d)
    } else {
      // This run has no design: don't leave another run's picture standing in for it.
      leaveDesign()
    }
    setCodes([])
    setShown(PAGE)
    startLoadCodes(async () => {
      const res = await getBatchCodes(id)
      if ("error" in res) toast.error(res.error)
      else setCodes(res.codes)
    })
  }

  function update(next: FlyerPlacement) {
    setPlacement(next)
    setDirty(true)
    if (!template) return
    try {
      localStorage.setItem(placementKey(template), JSON.stringify(next))
    } catch {
      // Storage can be blocked; the placement just isn't remembered.
    }
  }

  function updateBase(v: string) {
    setBaseInput(v)
    setDirty(true)
    try {
      localStorage.setItem("flyer-link-base", v)
    } catch {
      // not remembered
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    const t = await loadTemplate(file)
    if (!t) return
    if (template) URL.revokeObjectURL(template.url)
    setTemplate(t)
    setPendingFile(file)
    setDirty(true)
    if (!designName) setDesignName(file.name.replace(/\.[^.]+$/, ""))
    let saved: string | null = null
    try {
      saved = localStorage.getItem(placementKey(t))
    } catch {
      // ignore: start from the default
    }
    setPlacement(readPlacement(saved))
    if (baseInput === null && isLocalOrigin(origin)) {
      try {
        const b = localStorage.getItem("flyer-link-base")
        if (b) setBaseInput(b)
      } catch {
        // ignore
      }
    }
  }

  /** Build the PDF for `pages`, then save it or hand it to the share sheet. */
  async function exportPdf(pages: Code[], filename: string, share = false) {
    if (!template || pages.length === 0) return
    setProgress({ done: 0, total: pages.length })
    try {
      const bytes = await buildFlyerPdf({
        template,
        placement,
        codes: pages.map((c) => c.code),
        payload,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" })
      if (share) {
        const r = await shareFiles([new File([blob], filename, { type: "application/pdf" })], `${tenantName} flyers`, filename)
        if (r === "cancelled") return
        if (r === "unsupported") {
          download(blob, filename)
          toast.message("This browser can't open the share sheet, so the PDF was saved. Send it from your files.")
          return
        }
        return
      }
      download(blob, filename)
      toast.success(`${pages.length} flyer${pages.length === 1 ? "" : "s"} ready.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The PDF couldn't be built.")
    } finally {
      setProgress(null)
    }
  }

  function exportCsv() {
    if (!batch) return
    const rows = codes.map((c) => ({
      code: c.code,
      qr: payload(c.code),
      shared: c.shared ? "yes" : "no",
      redeemed: c.redeemed ? "yes" : "no",
    }))
    download(new Blob([toCsv(rows)], { type: "text/csv" }), `${slugify(batch.name)}-codes.csv`)
  }

  /** Record that a flyer went out, locally and on the server. */
  async function markShared(code: string) {
    if (!batch) return
    setCodes((prev) => prev.map((c) => (c.code === code ? { ...c, shared: true } : c)))
    const res = await markCouponShared(batch.id, code)
    if (res && "error" in res) toast.error(res.error)
    else router.refresh()
  }

  /** One flyer as a picture: the phone's share sheet where there is one, otherwise a saved file. */
  async function shareOne(c: Code, saveOnly = false) {
    if (!template || !batch) return
    setBusyCode(c.code)
    try {
      const blob = await renderFlyerImage({
        imageUrl: template.url,
        placement,
        code: c.code,
        payload: payload(c.code),
      })
      const file = new File([blob], `${c.code}.jpg`, { type: "image/jpeg" })
      if (!saveOnly) {
        const r = await shareFiles([file], message(c.code), `${tenantName} offer`)
        if (r === "cancelled") return
        if (r === "unsupported") {
          download(blob, file.name)
          toast.message("Saved the flyer. Attach it in WhatsApp, or use “Send text on WhatsApp”.")
        }
      } else {
        download(blob, file.name)
      }
      await markShared(c.code)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The flyer couldn't be made.")
    } finally {
      setBusyCode(null)
    }
  }

  /** Text-only: WhatsApp opens with the offer written out, to a number when one is typed. */
  async function textOne(c: Code) {
    window.open(whatsappLink(message(c.code), phone), "_blank", "noopener")
    await markShared(c.code)
  }

  const [pausing, startPausing] = useTransition()
  function confirmToggle(b: CouponBatchRow) {
    startPausing(async () => {
      const res = await setBatchActive(b.id, b.active === 0)
      if (res && "error" in res) toast.error(res.error)
      else toast.success(b.active === 0 ? "Run resumed." : "Run paused. Its flyers won't redeem until you resume it.")
      setPauseTarget(null)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={fileInput}
        id="flyer-template"
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />

      {loadError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Couldn&apos;t load the print runs: {loadError}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>1. Your flyer runs</CardTitle>
            <CardDescription>
              A run is a set of unique codes, one per flyer. A code works once, so a photographed flyer can&apos;t be
              reused. Select the run you want to print or share.
            </CardDescription>
          </div>
          {canManage ? (
            <Button className="h-11 shrink-0" onClick={() => setWizard({ step: "details", editing: false })}>
              <PlusIcon className="size-4" />
              New run
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No flyer runs yet. {canManage ? "Press New run to make your first set of codes, then add your flyer design." : "Ask a manager to create one."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table className="w-full text-sm">
                <TableHeader className="bg-muted/50 text-left">
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Valid till</TableHead>
                    <TableHead className="text-right">Codes</TableHead>
                    <TableHead className="text-right">Shared</TableHead>
                    <TableHead className="text-right">Redeemed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id} data-state={b.id === batchId ? "selected" : undefined}>
                      <TableCell className="font-medium">
                        {b.name}
                        {b.design_id ? null : <span className="block text-xs font-normal text-muted-foreground">No design yet</span>}
                      </TableCell>
                      <TableCell>{b.type === "percent" ? `${b.value}% off` : `${currency} ${b.value} off`}</TableCell>
                      <TableCell>{b.valid_to ? couponEndDay(b.valid_to, timezone) : "No end"}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.issued}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.shared}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.redeemed}</TableCell>
                      <TableCell>
                        {b.active === 0 ? (
                          <Badge variant="outline">
                            <PauseIcon /> Paused
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="flex justify-end gap-2">
                        <Button
                          variant={b.id === batchId ? "default" : "outline"}
                          className="h-11"
                          onClick={() => pick(b.id)}
                          aria-pressed={b.id === batchId}
                        >
                          {b.id === batchId ? <CheckIcon className="size-4" /> : null}
                          {b.id === batchId ? "Selected" : "Select"}
                        </Button>
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="outline" size="icon" className="size-11" aria-label={`More actions for ${b.name}`}>
                                  <MoreHorizontalIcon />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openWizard(b, "details")}>
                                <PencilIcon />
                                Edit name and dates
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openWizard(b, "design")}>
                                <ImageUpIcon />
                                {b.design_id ? "Change design" : "Add a design"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant={b.active === 0 ? undefined : "destructive"}
                                disabled={pausing}
                                onClick={() => (b.active === 0 ? confirmToggle(b) : setPauseTarget(b))}
                              >
                                {b.active === 0 ? <PlayIcon /> : <PauseIcon />}
                                {b.active === 0 ? "Resume run" : "Pause run"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Print or share</CardTitle>
          <CardDescription>
            Print the whole run from the PDF, or send flyers one at a time: each person gets their own code on their own picture.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {batch ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Design</span>
              <span className="font-medium">
                {loadingDesign ? "Loading…" : template ? designName || "Unsaved design" : "None yet"}
              </span>
              {template && !designId ? <Badge variant="outline">Not saved</Badge> : null}
              {template && designId && dirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
              {canManage ? (
                <Button variant="outline" className="h-11" onClick={() => setWizard({ step: "design", editing: true })}>
                  <ImageUpIcon className="size-4" />
                  {template ? "Change design" : "Add a design"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {!batch ? (
            <p className="text-sm text-muted-foreground">Select a run in step 1, or press New run.</p>
          ) : loadingCodes ? (
            <p className="text-sm text-muted-foreground">Loading codes…</p>
          ) : !template ? (
            <p className="text-sm text-muted-foreground">Add a flyer design to print or share.</p>
          ) : blocked ? (
            <p className="text-sm text-muted-foreground">Fix the link address in the design to continue.</p>
          ) : null}

          <section aria-labelledby="print-h" className="flex flex-col gap-3">
            <h3 id="print-h" className="text-sm font-semibold">Print the run</h3>
            <div className="flex flex-wrap gap-3">
              <Button
                className="h-11"
                disabled={!canExport}
                onClick={() => batch && exportPdf(codes, `${slugify(batch.name)}-flyers.pdf`)}
              >
                <DownloadIcon className="size-4" />
                {batch ? `Download all ${codes.length || batch.issued} flyers (PDF)` : "Download flyers (PDF)"}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={!canExport}
                onClick={() => batch && exportPdf(codes, `${slugify(batch.name)}-flyers.pdf`, true)}
              >
                <Share2Icon className="size-4" />
                Share PDF (to your printer)
              </Button>
              <Button
                variant="outline"
                className="h-11"
                disabled={!canExport}
                onClick={() => batch && exportPdf(codes.slice(0, 1), `${slugify(batch.name)}-proof.pdf`)}
              >
                <FileTextIcon className="size-4" />
                Proof (1 page)
              </Button>
              <Button variant="outline" className="h-11" disabled={!batch || codes.length === 0} onClick={exportCsv}>
                <DownloadIcon className="size-4" />
                Codes (CSV)
              </Button>
            </div>
            {exporting ? (
              <div role="status" aria-live="polite" className="flex flex-col gap-1">
                <progress className="h-2 w-full" value={progress.done} max={progress.total} />
                <span className="text-sm text-muted-foreground tabular-nums">
                  Building page {progress.done} of {progress.total}…
                </span>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Take one proof to your printer first and scan it before printing the whole run.
            </p>
          </section>

          <section aria-labelledby="share-h" className="flex flex-col gap-3 border-t pt-6">
            <h3 id="share-h" className="text-sm font-semibold">Share one by one</h3>
            <p className="text-sm text-muted-foreground">
              On a phone, Share opens WhatsApp and your other apps with the flyer attached. On a computer it saves the
              picture, and you can send the offer as text instead. Each flyer is marked <strong>Shared</strong> so you
              don&apos;t send the same code twice.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <Button
                size="lg"
                className="h-12 px-6 text-base"
                disabled={!canExport || !nextFree || busyCode !== null}
                onClick={() => nextFree && shareOne(nextFree)}
              >
                <Share2Icon className="size-5" />
                {nextFree ? `Share next flyer (${nextFree.code})` : "No unshared flyers left"}
              </Button>
              <Field className="w-full max-w-64">
                <FieldLabel htmlFor="flyer-phone">WhatsApp number (optional)</FieldLabel>
                <Input
                  id="flyer-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="97798XXXXXXXX"
                  className="h-11"
                />
              </Field>
              <Button
                variant="outline"
                className="h-11"
                disabled={!canExport || !nextFree || busyCode !== null}
                onClick={() => nextFree && textOne(nextFree)}
              >
                <MessageCircleIcon className="size-4" />
                Send text on WhatsApp
              </Button>
            </div>
            <FieldDescription>
              With a number (country code first, digits only) the text opens that person&apos;s chat. A picture can only be
              attached from the Share button.
            </FieldDescription>

            <div role="group" aria-label="Show flyers" className="flex flex-wrap gap-2">
              {(
                [
                  ["free", `Not shared (${counts.free})`],
                  ["shared", `Shared (${counts.shared})`],
                  ["redeemed", `Redeemed (${counts.redeemed})`],
                  ["all", `All (${codes.length})`],
                ] as [CodeFilter, string][]
              ).map(([key, label]) => (
                <Button
                  key={key}
                  variant={filter === key ? "default" : "outline"}
                  className="h-11"
                  aria-pressed={filter === key}
                  onClick={() => {
                    setFilter(key)
                    setShown(PAGE)
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>

            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {codes.length === 0 ? "No codes loaded." : "Nothing here yet."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table className="w-full text-sm">
                  <TableHeader className="bg-muted/50 text-left">
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.slice(0, shown).map((c) => (
                      <TableRow key={c.code}>
                        <TableCell className="font-mono font-medium">{c.code}</TableCell>
                        <TableCell>
                          {c.redeemed ? (
                            <Badge variant="default">
                              <CheckIcon /> Redeemed
                            </Badge>
                          ) : c.shared ? (
                            <Badge variant="secondary">
                              <SendIcon /> Shared
                            </Badge>
                          ) : (
                            <Badge variant="outline">Not shared</Badge>
                          )}
                        </TableCell>
                        <TableCell className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            className="h-11"
                            disabled={!canExport || busyCode !== null || c.redeemed}
                            onClick={() => shareOne(c)}
                          >
                            <Share2Icon className="size-4" />
                            {busyCode === c.code ? "Preparing…" : "Share"}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-11"
                            disabled={!canExport || busyCode !== null || c.redeemed}
                            onClick={() => shareOne(c, true)}
                            aria-label={`Save picture for ${c.code}`}
                          >
                            <DownloadIcon className="size-4" />
                            Save
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {list.length > shown ? (
              <div>
                <Button variant="outline" className="h-11" onClick={() => setShown((n) => n + PAGE)}>
                  Show more ({list.length - shown} left)
                </Button>
              </div>
            ) : null}
          </section>
        </CardContent>
      </Card>

      <Dialog open={wizard !== null} onOpenChange={(o) => !o && setWizard(null)}>
        <DialogContent size="full">
          <DialogHeader>
            <DialogTitle>
              {wizard?.step === "details"
                ? wizard.editing
                  ? `Edit ${batch?.name ?? "run"}`
                  : "New flyer run"
                : `Design the flyer${batch ? ` for ${batch.name}` : ""}`}
            </DialogTitle>
            <DialogDescription>
              {wizard?.step === "details"
                ? wizard.editing
                  ? "Rename the run or move its dates."
                  : "Step 1 of 2 · The deal and how many flyers."
                : wizard?.editing
                  ? "Pick a saved design or upload a picture, then place the code and QR."
                  : "Step 2 of 2 · Pick a saved design or upload a picture, then place the code and QR."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-6">
            {wizard?.step === "details" ? (
              <RunForm
                key={wizard.editing ? (batchId ?? "edit") : "new"}
                run={wizard.editing ? batch : null}
                slug={slug}
                currency={currency}
                timezone={timezone}
                onDone={(id) => {
                  router.refresh()
                  if (wizard.editing) {
                    setWizard(null)
                    return
                  }
                  // A new run exists from this moment: leaving now just leaves it without a design.
                  pick(id)
                  setWizard({ step: "design", editing: false })
                }}
              />
            ) : wizard?.step === "design" ? (
              <>
                {!template ? (
                  <DesignGallery
                    designs={designs}
                    activeId={designId}
                    loading={loadingDesign}
                    onPick={(d) => void loadDesign(d)}
                    onUpload={() => fileInput.current?.click()}
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button variant="outline" className="h-11" onClick={leaveDesign}>
                        Choose a different design
                      </Button>
                      <Button variant="outline" className="h-11" onClick={() => fileInput.current?.click()}>
                        <ImageUpIcon className="size-4" />
                        Replace picture
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {template.name} · {template.width}×{template.height}px
                      </span>
                    </div>
    {template ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <FlyerEditor
              imageUrl={template.url}
              imageW={template.width}
              imageH={template.height}
              placement={placement}
              onChange={update}
              sampleCode={sample}
              payload={payload(sample)}
            />
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="flyer-code-color">Code colour</FieldLabel>
                  <Input
                    id="flyer-code-color"
                    type="color"
                    value={placement.codeColor}
                    onChange={(e) => update({ ...placement, codeColor: e.target.value })}
                    className="h-11 p-1"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="flyer-qr-color">QR colour</FieldLabel>
                  <Input
                    id="flyer-qr-color"
                    type="color"
                    value={placement.qrColor}
                    onChange={(e) => update({ ...placement, qrColor: e.target.value })}
                    className="h-11 p-1"
                  />
                  <FieldDescription>Keep it dark on a light square so phones read it.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="flyer-code-size">Code size</FieldLabel>
                  <input
                    id="flyer-code-size"
                    type="range"
                    min={0.3}
                    max={1}
                    step={0.05}
                    value={placement.codeScale}
                    onChange={(e) => update({ ...placement, codeScale: Number(e.target.value) })}
                    className="h-11 w-full"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="flyer-qr-inset">QR margin</FieldLabel>
                  <input
                    id="flyer-qr-inset"
                    type="range"
                    min={0}
                    max={0.15}
                    step={0.01}
                    value={placement.qrInset}
                    onChange={(e) => update({ ...placement, qrInset: Number(e.target.value) })}
                    className="h-11 w-full"
                  />
                </Field>
              </div>
    
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">What the QR carries</legend>
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input type="radio" name="flyer-mode" checked={mode === "url"} onChange={() => { setMode("url"); setDirty(true) }} className="mt-1 size-4" />
                  <span>
                    <span className="font-medium">Storefront link (recommended)</span>
                    <span className="block text-muted-foreground">
                      A guest&apos;s phone camera opens your menu with the code filled in. The POS app reads it too.
                    </span>
                  </span>
                </label>
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input type="radio" name="flyer-mode" checked={mode === "code"} onChange={() => { setMode("code"); setDirty(true) }} className="mt-1 size-4" />
                  <span>
                    <span className="font-medium">Code only</span>
                    <span className="block text-muted-foreground">A smaller, simpler QR. Only the POS app uses it; a phone camera shows plain text.</span>
                  </span>
                </label>
              </fieldset>
    
              {mode === "url" && slug ? (
                <Field>
                  <FieldLabel htmlFor="flyer-base">Link address</FieldLabel>
                  <Input
                    id="flyer-base"
                    type="url"
                    inputMode="url"
                    value={baseInput ?? origin}
                    onChange={(e) => updateBase(e.target.value)}
                    placeholder="https://your-site.com"
                    className="h-11"
                    aria-invalid={blocked}
                  />
                  <FieldDescription>
                    Where the QR sends a guest&apos;s phone. Leave it as is on your live site; on a test copy, type the live address.
                  </FieldDescription>
                </Field>
              ) : null}
    
              <p className="break-all rounded-md bg-muted p-2 text-xs text-muted-foreground">
                Sample QR text: <span className="font-mono">{payload(sample)}</span>
              </p>
              {baseProblem ? (
                <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{baseProblem}</span>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
    
                    <Field className="max-w-sm">
                      <FieldLabel htmlFor="design-name">Design name</FieldLabel>
                      <Input
                        id="design-name"
                        value={designName}
                        onChange={(e) => {
                          setDesignName(e.target.value)
                          setDirty(true)
                        }}
                        maxLength={80}
                        placeholder="Dashain A4"
                        className="h-11"
                      />
                      <FieldDescription>
                        {designId && !dirty
                          ? "Saved. Any device or login can use it."
                          : designId
                            ? "Unsaved changes."
                            : "Not saved yet. Save it so you don't have to upload again."}
                      </FieldDescription>
                    </Field>
                  </div>
                )}
              </>
            ) : null}
          </DialogBody>
          {wizard?.step === "design" ? (
            <DialogFooter>
              {designId ? (
                <Button variant="outline" className="h-11 sm:mr-auto" disabled={saving} onClick={() => setDeleteOpen(true)}>
                  <Trash2Icon className="size-4" />
                  Delete design
                </Button>
              ) : null}
              <Button variant="outline" className="h-11" onClick={() => setWizard(null)}>
                {template ? "Close" : "Finish later"}
              </Button>
              {canManage && designId && template ? (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={!designName.trim() || saving || loadingDesign || blocked}
                  onClick={() => saveDesign(() => setWizard(null), true)}
                >
                  Save as a new copy
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  className="h-11"
                  disabled={!template || !designName.trim() || saving || loadingDesign || blocked}
                  onClick={() => saveDesign(() => setWizard(null))}
                >
                  <SaveIcon className="size-4" />
                  {saving ? "Saving…" : "Save design and finish"}
                </Button>
              ) : null}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {designName || "this design"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved template picture and its placement are removed. Your runs and their codes stay, but you will
              need to upload a template again to print or share.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={removeDesign}>Delete design</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pauseTarget !== null} onOpenChange={(o) => !o && setPauseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {pauseTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every printed flyer in this run stops redeeming until you resume it. Use it when flyers go missing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction onClick={() => pauseTarget && confirmToggle(pauseTarget)}>Pause run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
