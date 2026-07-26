"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  createPrinter,
  updatePrinter,
  type PrinterInput,
} from "@/app/(app)/settings/printers-actions"
import {
  CONNECTION_LABELS,
  PAPER_WIDTHS,
  ROLE_LABELS,
  type PrinterConnection,
  type PrinterRole,
} from "@/lib/print/types"
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
import type { PrinterRow } from "./types"

const BLANK: PrinterInput = {
  name: "",
  connection: "network",
  host: "",
  port: 9100,
  systemName: "",
  paperWidth: 80,
  role: "both",
  isDefault: false,
  isActive: true,
}

function toInput(p: PrinterRow): PrinterInput {
  return {
    name: p.name,
    connection: p.connection,
    host: p.host ?? "",
    port: p.port,
    systemName: p.system_name ?? "",
    paperWidth: p.paper_width,
    role: p.role,
    isDefault: p.is_default,
    isActive: p.is_active,
  }
}

/** Add or edit one printer. `printer` null = create. */
export function PrinterSheet({
  printer,
  open,
  onOpenChange,
}: {
  printer: PrinterRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState<PrinterInput>(BLANK)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Seed by id during render, not in an effect — an effect paints the previous
  // printer's values for a frame first.
  const [seededId, setSeededId] = useState<string | null>(null)
  const currentId = printer?.id ?? null
  if (open && seededId !== currentId) {
    setSeededId(currentId)
    setForm(printer ? toInput(printer) : BLANK)
    setErr(null)
  }
  if (!open && seededId !== null) setSeededId(null)

  function set<K extends keyof PrinterInput>(key: K, value: PrinterInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function save() {
    startTransition(async () => {
      setErr(null)
      const res = printer
        ? await updatePrinter(printer.id, form)
        : await createPrinter(form)
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
            Thermal receipt printers, on the network or plugged into this computer.
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
            <FieldDescription>What staff will call it. &ldquo;Grill&rdquo;, &ldquo;Bar&rdquo;, &ldquo;Counter&rdquo;.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="printer-connection">Connection</FieldLabel>
            <Select
              value={form.connection}
              onValueChange={(v) => set("connection", (v ?? "network") as PrinterConnection)}
            >
              <SelectTrigger id="printer-connection" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="network">{CONNECTION_LABELS.network}</SelectItem>
                <SelectItem value="system">{CONNECTION_LABELS.system}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

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
                  changing (DHCP) address it stops printing the next time the router
                  restarts.
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
          ) : (
            <Field>
              <FieldLabel htmlFor="printer-system-name">Printer name</FieldLabel>
              <Input
                id="printer-system-name"
                value={form.systemName}
                onChange={(e) => set("systemName", e.target.value)}
                placeholder="EPSON TM-T88VI"
              />
              <FieldDescription>
                Exactly as it appears in this computer&apos;s printer list.
              </FieldDescription>
            </Field>
          )}

          <div className="flex flex-wrap gap-4">
            <Field className="w-40">
              <FieldLabel htmlFor="printer-paper">Paper width</FieldLabel>
              <Select
                value={String(form.paperWidth)}
                onValueChange={(v) => set("paperWidth", Number(v ?? 80))}
              >
                <SelectTrigger id="printer-paper" className="w-full">
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
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="printer-role">Prints</FieldLabel>
              <Select
                value={form.role}
                onValueChange={(v) => set("role", (v ?? "both") as PrinterRole)}
              >
                <SelectTrigger id="printer-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kot">{ROLE_LABELS.kot}</SelectItem>
                  <SelectItem value="receipt">{ROLE_LABELS.receipt}</SelectItem>
                  <SelectItem value="both">{ROLE_LABELS.both}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="printer-default" className="flex items-center gap-2 font-medium">
              <Checkbox
                id="printer-default"
                checked={form.isDefault}
                onCheckedChange={(v) => set("isDefault", v === true)}
              />
              Use this one by default
            </FieldLabel>
            <FieldDescription>
              Where anything without its own printer goes. One per job type.
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
              Turn off while a printer is away for repair — its tickets fall back instead of
              failing.
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
