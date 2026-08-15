"use client"

import { useState, useTransition } from "react"
import { InfoIcon, MinusIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import { savePrinter, type PrinterInput } from "@/app/(app)/settings/printers-actions"
import {
  ASSIGNABLE_DOCS,
  CONNECTION_LABELS,
  DOC_DESCRIPTIONS,
  DOC_LABELS,
  PAPER_WIDTHS,
  RENDER_MODE_LABELS,
  type PrintDoc,
  type PrinterConnection,
  type PrinterRenderMode,
} from "@/lib/print/types"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { usePrintAgent } from "@/components/print/print-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { Branch, PrinterRow } from "./types"

/** base-ui rejects an empty Select value, so "no branch" needs a sentinel. */
const ALL_BRANCHES = "__all__"

const BLANK: PrinterInput = {
  id: null,
  name: "",
  connection: "network",
  host: "",
  port: 9100,
  systemName: "",
  usbVendorId: "",
  usbProductId: "",
  btAddress: "",
  paperWidth: 80,
  renderMode: "text",
  autoCut: true,
  openDrawer: false,
  branchId: null,
  isActive: true,
  docs: [],
}

function toInput(p: PrinterRow): PrinterInput {
  return {
    id: p.id,
    name: p.name,
    connection: p.connection,
    host: p.host ?? "",
    port: p.port,
    systemName: p.system_name ?? "",
    usbVendorId: p.usb_vendor_id ?? "",
    usbProductId: p.usb_product_id ?? "",
    btAddress: p.bt_address ?? "",
    paperWidth: p.paper_width,
    renderMode: p.render_mode,
    autoCut: p.auto_cut,
    openDrawer: p.open_drawer,
    branchId: p.branch_id,
    isActive: p.is_active,
    docs: p.printer_documents.map((d) => ({ doc: d.doc, copies: d.copies })),
  }
}

/** The assignment groups, laid out the way a manager thinks about them. */
const DOC_GROUPS: { title: string; blurb: string; docs: PrintDoc[] }[] = [
  {
    title: "KOT & BOT",
    blurb: "Kitchen and bar tickets. A station's own printer is used first if it has one.",
    docs: ["full_kot", "kot", "bot"],
  },
  {
    title: "Bills & receipts",
    blurb:
      "Two switches, because they are two moments: the bill goes out before the guest pays, the receipt after. Turn the receipt off if the counter doesn't hand one over.",
    docs: ["bill", "receipt"],
  },
  { title: "Order slip", blurb: "The guest's or waiter's copy of what was ordered.", docs: ["order_slip"] },
]

/** Add or edit one printer. `printer` null = create. */
export function PrinterSheet({
  printer,
  branches,
  printingMode,
  open,
  onOpenChange,
}: {
  printer: PrinterRow | null
  branches: Branch[]
  /** Cloud mode drives network printers only — say so before they save. */
  printingMode: "local" | "cloud"
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<PrinterInput>(BLANK)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  /** Escape hatch when the agent can't be reached, or the name isn't listed. */
  const [manualName, setManualName] = useState(false)
  const [usbDevices, setUsbDevices] = useState<
    { vendorId: string; productId: string; manufacturer?: string; product?: string }[]
  >([])

  const { connected, systemPrinters, listSystemPrinters, listUsbDevices } = usePrintAgent()

  // Seed by id during render, not in an effect — an effect paints the previous
  // printer's values for a frame first.
  const [seededId, setSeededId] = useState<string | null>(null)
  const currentId = printer?.id ?? null
  if (open && seededId !== currentId) {
    setSeededId(currentId)
    setForm(printer ? toInput(printer) : BLANK)
    setErr(null)
    // Editing a printer that already has a name, or no agent to ask: typing is
    // the only thing that can work, so don't open on a Scan button that can't.
    setManualName(Boolean(printer?.system_name) || !connected)
    setScanned(false)
  }
  if (!open && seededId !== null) setSeededId(null)

  function set<K extends keyof PrinterInput>(key: K, value: PrinterInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleDoc(doc: PrintDoc) {
    setForm((f) =>
      f.docs.some((d) => d.doc === doc)
        ? { ...f, docs: f.docs.filter((d) => d.doc !== doc) }
        : { ...f, docs: [...f.docs, { doc, copies: 1 }] },
    )
  }

  function setCopies(doc: PrintDoc, copies: number) {
    setForm((f) => ({
      ...f,
      docs: f.docs.map((d) =>
        d.doc === doc ? { ...d, copies: Math.max(1, Math.min(5, copies)) } : d,
      ),
    }))
  }

  function scanUsb() {
    setScanning(true)
    void listUsbDevices()
      .then((devices) => {
        setUsbDevices(devices)
        if (!devices.length) toast.info("No USB devices found. Is the printer switched on?")
      })
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Could not scan for USB devices."),
      )
      .finally(() => setScanning(false))
  }

  function scanSystem() {
    setScanning(true)
    void listSystemPrinters()
      .then((list) => {
        setScanned(true)
        // Nothing to choose from: drop straight to typing rather than leaving a
        // dead Scan button as the only thing on screen.
        if (!list.length) setManualName(true)
      })
      .catch((e: unknown) => {
        setManualName(true)
        toast.error(e instanceof Error ? e.message : "Could not list printers.")
      })
      .finally(() => setScanning(false))
  }

  function save() {
    startTransition(async () => {
      setErr(null)
      const res = await savePrinter(form)
      if (res && "error" in res) {
        setErr(res.error)
        return
      }
      toast.success(printer ? "Printer updated." : "Printer added.")
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="w-full gap-0">
        <SheetHeader>
          <SheetTitle>{printer ? "Edit printer" : "Add printer"}</SheetTitle>
          <SheetDescription>
            Where it is, how wide the paper is, and what it prints on its own.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6">
          <Field>
            <FieldLabel htmlFor="printer-name">Name</FieldLabel>
            <Input
              id="printer-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Kitchen · 80mm"
            />
            <FieldDescription>
              What staff will call it. &ldquo;Grill&rdquo;, &ldquo;Bar&rdquo;, &ldquo;Counter&rdquo;.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="printer-paper">Paper width</FieldLabel>
            <Select
              value={String(form.paperWidth)}
              onValueChange={(v) => set("paperWidth", Number(v ?? 80))}
            >
              <SelectTrigger id="printer-paper" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPER_WIDTHS.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w}mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Connection</legend>
            <div className="flex flex-wrap gap-2">
              {(["network", "usb", "system", "bluetooth"] as PrinterConnection[]).map((c) => (
                <ChoiceChip
                  key={c}
                  name="printer-connection"
                  checked={form.connection === c}
                  onSelect={() => set("connection", c)}
                  label={CONNECTION_LABELS[c]}
                  showCheck
                />
              ))}
            </div>
            {/* Bluetooth answers to neither mode — no browser and no server can
                open an SPP socket, so it is the phone or nothing. */}
            {form.connection === "bluetooth" ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-blue-700 dark:text-blue-400">
                <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Bluetooth tickets are printed by the <strong>ExtraHelper app on an Android
                  phone</strong> that is paired with this printer, whichever printing mode you
                  are in. Neither a browser nor the cloud agent can open a Bluetooth
                  connection. On iPhone, use WiFi instead.
                </span>
              </p>
            ) : printingMode === "cloud" && form.connection !== "network" ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  You are on <strong>Cloud</strong> printing. The agent drives network printers
                  only, so this one will not print until you switch back to Local.
                </span>
              </p>
            ) : null}
          </fieldset>

          {form.connection === "network" ? (
            <div className="flex flex-wrap gap-4">
              <Field className="min-w-48 flex-1">
                <FieldLabel htmlFor="printer-host">IP address</FieldLabel>
                <Input
                  id="printer-host"
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="192.168.1.50"
                  className="tabular-nums"
                />
                <FieldDescription>
                  Give the printer a <strong>fixed</strong> address in your router. On a
                  changing (DHCP) address it stops printing the next time the router restarts.
                </FieldDescription>
              </Field>
              <Field className="w-28">
                <FieldLabel htmlFor="printer-port">Port</FieldLabel>
                <Input
                  id="printer-port"
                  type="number"
                  min="1"
                  max="65535"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  value={form.port}
                  onChange={(e) => set("port", Number(e.target.value))}
                />
                <FieldDescription>Usually 9100.</FieldDescription>
              </Field>
            </div>
          ) : form.connection === "usb" ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="printer-usb-scan">Scan for USB devices</FieldLabel>
                <div className="flex gap-2">
                  <Select
                    value={
                      form.usbVendorId && form.usbProductId
                        ? `${form.usbVendorId}|${form.usbProductId}`
                        : undefined
                    }
                    onValueChange={(v) => {
                      const [vendor, product] = String(v ?? "").split("|")
                      set("usbVendorId", vendor ?? "")
                      set("usbProductId", product ?? "")
                    }}
                    disabled={!usbDevices.length}
                  >
                    <SelectTrigger id="printer-usb-scan" className="flex-1">
                      <SelectValue placeholder="Select a scanned device" />
                    </SelectTrigger>
                    <SelectContent>
                      {usbDevices.map((d) => (
                        <SelectItem
                          key={`${d.vendorId}|${d.productId}`}
                          value={`${d.vendorId}|${d.productId}`}
                        >
                          {d.product || d.manufacturer
                            ? `${d.manufacturer ?? ""} ${d.product ?? ""}`.trim()
                            : `${d.vendorId} / ${d.productId}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={scanUsb}
                    disabled={scanning || !connected}
                  >
                    <RefreshCwIcon />
                    Scan
                  </Button>
                </div>
                <FieldDescription>
                  {connected
                    ? "Scanning asks the print agent on this computer what is plugged in."
                    : "The print agent isn't running on this computer, so scanning is unavailable. Type the IDs from the label instead."}
                </FieldDescription>
              </Field>

              <div className="flex flex-wrap gap-4">
                <Field className="min-w-40 flex-1">
                  <FieldLabel htmlFor="printer-vendor">Vendor ID</FieldLabel>
                  <Input
                    id="printer-vendor"
                    value={form.usbVendorId}
                    onChange={(e) => set("usbVendorId", e.target.value)}
                    placeholder="0x04b8"
                    className="tabular-nums"
                  />
                </Field>
                <Field className="min-w-40 flex-1">
                  <FieldLabel htmlFor="printer-product">Product ID</FieldLabel>
                  <Input
                    id="printer-product"
                    value={form.usbProductId}
                    onChange={(e) => set("usbProductId", e.target.value)}
                    placeholder="0x0e15"
                    className="tabular-nums"
                  />
                </Field>
              </div>
            </div>
          ) : form.connection === "bluetooth" ? (
            <Field>
              <FieldLabel htmlFor="printer-bt">Bluetooth address</FieldLabel>
              <Input
                id="printer-bt"
                value={form.btAddress}
                onChange={(e) => set("btAddress", e.target.value)}
                placeholder="66:32:B1:00:1A:2C"
                className="tabular-nums uppercase"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <FieldDescription>
                Pair the printer with the phone first, then open{" "}
                <strong>Settings → Printing</strong> in the ExtraHelper app — it lists every
                paired printer with its address, so you can copy it rather than type it.
              </FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="printer-system-name">Printer name</FieldLabel>

              {/* Free text is the fallback, never the default. A typed name that
                  doesn't match the OS exactly fails at print time and looks like
                  a broken printer rather than a typo. */}
              {systemPrinters.length && !manualName ? (
                <div className="flex gap-2">
                  <Select
                    value={form.systemName || undefined}
                    onValueChange={(v) => set("systemName", String(v ?? ""))}
                  >
                    <SelectTrigger id="printer-system-name" className="flex-1">
                      <SelectValue placeholder="Select a printer" />
                    </SelectTrigger>
                    <SelectContent>
                      {systemPrinters.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={scanSystem}
                    disabled={scanning}
                  >
                    <RefreshCwIcon />
                    {scanning ? "Scanning…" : "Rescan"}
                  </Button>
                </div>
              ) : connected && !manualName ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
                  <p className="text-sm text-muted-foreground">
                    {scanned
                      ? "The print agent reported no printers on this computer."
                      : "Ask this computer which printers it has."}
                  </p>
                  <Button type="button" onClick={scanSystem} disabled={scanning}>
                    <RefreshCwIcon />
                    {scanning ? "Scanning…" : "Scan for printers"}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="printer-system-name"
                    value={form.systemName}
                    onChange={(e) => set("systemName", e.target.value)}
                    placeholder="EPSON TM-T88VI"
                    className="flex-1"
                  />
                  {connected ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setManualName(false)
                        scanSystem()
                      }}
                      disabled={scanning}
                    >
                      <RefreshCwIcon />
                      {scanning ? "Scanning…" : "Scan"}
                    </Button>
                  ) : null}
                </div>
              )}

              {/* Says why, next to the control, rather than in a toast that has
                  already gone by the time anyone wonders. */}
              {!connected ? (
                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Scanning needs QZ Tray running on this computer — a browser cannot see the
                    printer list on its own. Install it from Settings → Printers → Set it up, or
                    type the name exactly as it appears in your system settings.
                  </span>
                </p>
              ) : null}

              {systemPrinters.length || connected ? (
                <FieldDescription>
                  {manualName ? (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => setManualName(false)}
                    >
                      Pick from the scanned list instead
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => setManualName(true)}
                    >
                      Can&apos;t see it? Type the name manually
                    </button>
                  )}
                </FieldDescription>
              ) : null}

              <FieldDescription>
                System printers are driven by QZ Tray in the browser, so they only work in
                <strong> Local</strong> printing mode. And the printer has to understand ESC/POS —
                an office inkjet or laser will print the raw codes as nonsense.
              </FieldDescription>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="printer-render">How it prints</FieldLabel>
            <Select
              value={form.renderMode}
              onValueChange={(v) => set("renderMode", (v ?? "text") as PrinterRenderMode)}
            >
              <SelectTrigger id="printer-render" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{RENDER_MODE_LABELS.text}</SelectItem>
                <SelectItem value="image">{RENDER_MODE_LABELS.image}</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Text is fastest and sharpest, but prints only Latin characters — a Nepali dish
              name comes out as question marks. Image draws the whole ticket, so any script
              prints correctly. Image needs a browser with the print agent, so it does not
              work in Cloud mode.
            </FieldDescription>
          </Field>

          {branches.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="printer-branch">Branch</FieldLabel>
              <Select
                value={form.branchId ?? ALL_BRANCHES}
                onValueChange={(v) =>
                  set("branchId", v === ALL_BRANCHES || !v ? null : String(v))
                }
              >
                <SelectTrigger id="printer-branch" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>Every branch</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                A printer tied to a branch only ever prints that branch&apos;s orders.
              </FieldDescription>
            </Field>
          ) : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Select what you print here</legend>
            {DOC_GROUPS.map((group) => (
              <div key={group.title} className="rounded-lg border p-4">
                <p className="font-medium">{group.title}</p>
                <p className="text-sm text-muted-foreground">{group.blurb}</p>
                <div className="mt-3 flex flex-col gap-3">
                  {group.docs.map((doc) => {
                    const assigned = form.docs.find((d) => d.doc === doc)
                    return (
                      <div key={doc} className="flex items-center gap-3">
                        <FieldLabel
                          htmlFor={`doc-${doc}`}
                          className="flex flex-1 items-start gap-2 font-normal"
                        >
                          <Checkbox
                            id={`doc-${doc}`}
                            checked={Boolean(assigned)}
                            onCheckedChange={() => toggleDoc(doc)}
                          />
                          <span>
                            <span className="block font-medium">{DOC_LABELS[doc]}</span>
                            <span className="block text-sm text-muted-foreground">
                              {DOC_DESCRIPTIONS[doc]}
                            </span>
                          </span>
                        </FieldLabel>
                        {assigned ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`One less copy of ${DOC_LABELS[doc]}`}
                              disabled={assigned.copies <= 1}
                              onClick={() => setCopies(doc, assigned.copies - 1)}
                            >
                              <MinusIcon />
                            </Button>
                            <span className="w-6 text-center tabular-nums" aria-live="polite">
                              {assigned.copies}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`One more copy of ${DOC_LABELS[doc]}`}
                              disabled={assigned.copies >= 5}
                              onClick={() => setCopies(doc, assigned.copies + 1)}
                            >
                              <PlusIcon />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              Assign nothing and this printer never prints on its own — it stays available
              for a manual print. {ASSIGNABLE_DOCS.length} documents can be assigned.
            </p>
          </fieldset>

          <Field>
            <FieldLabel htmlFor="printer-cut" className="flex items-center gap-2 font-medium">
              <Checkbox
                id="printer-cut"
                checked={form.autoCut}
                onCheckedChange={(v) => set("autoCut", v === true)}
              />
              Cut the paper
            </FieldLabel>
            <FieldDescription>
              Turn off for a printer with no cutter — otherwise the cut command prints as
              stray characters on the ticket.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="printer-drawer" className="flex items-center gap-2 font-medium">
              <Checkbox
                id="printer-drawer"
                checked={form.openDrawer}
                onCheckedChange={(v) => set("openDrawer", v === true)}
              />
              Open the cash drawer
            </FieldLabel>
            <FieldDescription>
              Only for the printer with a drawer wired to it, and only on cash payments.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="printer-active" className="flex items-center gap-2 font-medium">
              <Checkbox
                id="printer-active"
                checked={form.isActive}
                onCheckedChange={(v) => set("isActive", v === true)}
              />
              Active
            </FieldLabel>
            <FieldDescription>
              Turn off while a printer is away for repair — its documents go to whichever
              other printer is assigned them, instead of failing.
            </FieldDescription>
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Saving…" : printer ? "Save printer" : "Add printer"}
            </Button>
            {err ? (
              <p className="text-sm text-destructive" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
