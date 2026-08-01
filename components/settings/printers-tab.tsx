"use client"

import { useMemo, useState, useTransition } from "react"
import {
  BluetoothIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  CloudIcon,
  FileTextIcon,
  MinusIcon,
  NetworkIcon,
  PlugIcon,
  PlugZapIcon,
  PlusIcon,
  PrinterIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  UsbIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"

import { deletePrinter, setPrintingMode } from "@/app/(app)/settings/printers-actions"
import { retryPrintJob } from "@/app/(app)/print/actions"
import { formatDateTime } from "@/lib/format"
import {
  ASSIGNABLE_DOCS,
  CONNECTION_LABELS,
  DOC_LABELS,
  JOB_STATUS_LABELS,
  printerTarget,
} from "@/lib/print/types"
import { usePrintAgent } from "@/components/print/print-provider"
import { usePrint } from "@/components/print/use-print"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { PrinterSheet } from "./printer-sheet"
import { PrintSetupDialog } from "./print-setup-dialog"
import type { Branch, PrinterRow, PrintJobRow } from "./types"

/** Status meaning carried by icon + words; colour only reinforces it. */
const JOB_STATUS = {
  printed: { icon: CheckIcon, tone: "text-emerald-700 dark:text-emerald-400" },
  queued: { icon: ClockIcon, tone: "text-amber-700 dark:text-amber-400" },
  claimed: { icon: RefreshCwIcon, tone: "text-blue-700 dark:text-blue-400" },
  failed: { icon: TriangleAlertIcon, tone: "text-destructive" },
  cancelled: { icon: MinusIcon, tone: "text-muted-foreground" },
} as const

export function PrintersTab({
  printers,
  jobs,
  branches,
  printerLimit,
  printingMode,
  timezone,
}: {
  printers: PrinterRow[]
  jobs: PrintJobRow[]
  branches: Branch[]
  printerLimit: number | null
  printingMode: "local" | "cloud"
  timezone: string
}) {
  // Held by id, not by object — the row is derived from the live list so a
  // revalidate shows through without closing the sheet.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [agentHelp, setAgentHelp] = useState(false)
  const [testResults, setTestResults] = useState<{ name: string; ok: boolean }[] | null>(null)
  const [pending, startTransition] = useTransition()

  const { status: agentStatus } = usePrintAgent()
  const { printTest } = usePrint()

  const editing = printers.find((p) => p.id === editingId) ?? null
  const doomed = printers.find((p) => p.id === confirmDelete) ?? null

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return printers
    return printers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        printerTarget(p).toLowerCase().includes(q) ||
        CONNECTION_LABELS[p.connection].toLowerCase().includes(q),
    )
  }, [printers, query])

  // Anything not finished is what a manager actually needs to see; the rest is
  // history. A failed ticket that only ever appeared as a toast is a ticket
  // nobody knows is missing.
  const pendingJobs = jobs.filter((j) => j.status !== "printed" && j.status !== "cancelled")
  const history = jobs.filter((j) => j.status === "printed" || j.status === "cancelled")

  const atLimit = printerLimit !== null && printers.length >= printerLimit

  function remove(id: string) {
    startTransition(async () => {
      const res = await deletePrinter(id)
      if (res && "error" in res) toast.error(res.error)
      else toast.success("Printer removed.")
      setConfirmDelete(null)
    })
  }

  function changeMode(mode: "local" | "cloud") {
    startTransition(async () => {
      const res = await setPrintingMode(mode)
      if (res && "error" in res) toast.error(res.error)
    })
  }

  function testAll() {
    const active = printers.filter((p) => p.is_active)
    if (!active.length) {
      setTestResults([])
      return
    }
    startTransition(async () => {
      const results = await Promise.all(
        active.map(async (p) => ({ name: p.name, ok: (await printTest(p.id)) === "queued" })),
      )
      setTestResults(results)
    })
  }

  function retry(jobId: string) {
    startTransition(async () => {
      const res = await retryPrintJob(jobId)
      if ("error" in res) toast.error(res.error)
      else toast.success("Back in the queue.")
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Three things a manager checks before service: how many printers, is
          the bridge up, and which way jobs are being sent. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PrinterIcon className="size-4" aria-hidden />
              Total printers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {printers.length}
              {printerLimit !== null ? (
                <span className="text-muted-foreground">/{printerLimit}</span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {printerLimit === null
                ? "Unlimited on your plan."
                : atLimit
                  ? "Your plan is full. Upgrade to add more."
                  : `${printerLimit - printers.length} left on your plan.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ZapIcon className="size-4" aria-hidden />
              Direct printing
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            <AgentBadge status={agentStatus} />
            <p className="text-sm text-muted-foreground">
              {agentStatus === "connected"
                ? "Tickets go straight to the printer, with no print dialog."
                : "Not detected on this computer. Jobs wait in the queue until a computer with the agent picks them up."}
            </p>
            <Button
              type="button"
              variant={agentStatus === "connected" ? "outline" : "default"}
              size="sm"
              onClick={() => setAgentHelp(true)}
            >
              <FileTextIcon />
              {agentStatus === "connected" ? "Setup and downloads" : "Set it up"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {printingMode === "cloud" ? (
                <CloudIcon className="size-4" aria-hidden />
              ) : (
                <NetworkIcon className="size-4" aria-hidden />
              )}
              Printing mode
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Field>
              <FieldLabel htmlFor="printing-mode" className="sr-only">
                Printing mode
              </FieldLabel>
              <Select
                value={printingMode}
                onValueChange={(v) => changeMode(String(v) as "local" | "cloud")}
                disabled={pending}
              >
                <SelectTrigger id="printing-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="cloud">Cloud</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <p className="text-sm text-muted-foreground">
              {printingMode === "cloud"
                ? "A print agent on a machine in the restaurant takes jobs off the queue — no browser needs to be open."
                : "Printers are driven from this browser over your local network via QZ Tray."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Printers</CardTitle>
          <CardDescription>
            A printer prints a document automatically when that document is assigned to it.
            Kitchen and bar tickets follow the station they belong to first. A printer with
            nothing assigned still works — it just has to be chosen by hand.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Search printers"
                placeholder="Search printers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={testAll}
              disabled={pending || printers.length === 0}
            >
              <PrinterIcon />
              Test all printers
            </Button>
            <Button type="button" onClick={() => setCreating(true)} disabled={atLimit}>
              <PlusIcon />
              Add printer
            </Button>
          </div>

          {printers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <PrinterIcon className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 font-medium">No printers yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your thermal printer, assign it the tickets or bills it should print, and
                they start coming out on their own.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No printer matches “{query}”.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    {ASSIGNABLE_DOCS.map((doc) => (
                      <TableHead key={doc} className="text-center">
                        {DOC_LABELS[doc]}
                      </TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p, i) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.name}
                        {p.render_mode === "image" ? (
                          <Badge className="ml-2 border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400">
                            Image
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          {p.connection === "usb" ? (
                            <UsbIcon className="size-4 shrink-0" aria-hidden />
                          ) : p.connection === "network" ? (
                            <NetworkIcon className="size-4 shrink-0" aria-hidden />
                          ) : p.connection === "bluetooth" ? (
                            <BluetoothIcon className="size-4 shrink-0" aria-hidden />
                          ) : (
                            <PrinterIcon className="size-4 shrink-0" aria-hidden />
                          )}
                          {CONNECTION_LABELS[p.connection]}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{printerTarget(p)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.paper_width}mm</TableCell>
                      {ASSIGNABLE_DOCS.map((doc) => {
                        const assigned = p.printer_documents.find((d) => d.doc === doc)
                        return (
                          <TableCell key={doc} className="text-center">
                            {/* Icon plus a word for the screen reader: a tick in
                                a column is not readable in greyscale alone. */}
                            {assigned ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <CheckIcon className="size-4" aria-hidden />
                                <span className="sr-only">
                                  Auto-prints {DOC_LABELS[doc]}
                                </span>
                                {assigned.copies > 1 ? (
                                  <span className="text-xs tabular-nums">×{assigned.copies}</span>
                                ) : null}
                              </span>
                            ) : (
                              <>
                                <MinusIcon
                                  className="inline size-4 text-muted-foreground"
                                  aria-hidden
                                />
                                <span className="sr-only">
                                  Does not auto-print {DOC_LABELS[doc]}
                                </span>
                              </>
                            )}
                          </TableCell>
                        )
                      })}
                      <TableCell>
                        {p.is_active ? (
                          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                            <CheckIcon className="size-4 shrink-0" aria-hidden />
                            Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <PlugZapIcon className="size-4 shrink-0" aria-hidden />
                            Disabled
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => void printTest(p.id)}
                          >
                            Test
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(p.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(p.id)}
                          >
                            Remove
                          </Button>
                        </div>
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
          <CardTitle>Print queue</CardTitle>
          <CardDescription>
            Anything waiting, printing, or that failed. A failed ticket stays here until
            somebody deals with it — it never disappears with a toast.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <JobTable
            jobs={pendingJobs}
            timezone={timezone}
            empty="Nothing waiting. Every ticket has printed."
            onRetry={retry}
            pending={pending}
          />
          {history.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Recently printed</h3>
              <JobTable jobs={history} timezone={timezone} empty="" pending={pending} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PrinterSheet
        printer={editing}
        branches={branches}
        printingMode={printingMode}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditingId(null)
          }
        }}
      />

      <PrintSetupDialog open={agentHelp} onOpenChange={setAgentHelp} />

      <Dialog
        open={testResults !== null}
        onOpenChange={(open) => {
          if (!open) setTestResults(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Printer test results</DialogTitle>
            <DialogDescription>
              A test page is queued for each active printer. Watch the paper — the queue above
              shows anything that fails.
            </DialogDescription>
          </DialogHeader>
          {testResults?.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {testResults.map((r) => (
                <li key={r.name} className="flex items-center justify-between gap-2">
                  <span>{r.name}</span>
                  <span
                    className={`flex items-center gap-1.5 ${
                      r.ok
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {r.ok ? (
                      <CheckIcon className="size-4" aria-hidden />
                    ) : (
                      <CircleAlertIcon className="size-4" aria-hidden />
                    )}
                    {r.ok ? "Queued" : "Could not queue"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active printers to test. Add one, or switch a disabled printer back on.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={doomed !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {doomed?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stations pointing at this printer lose their route, and anything it was set to
              print automatically stops printing. Tickets fall back to another printer if one
              is assigned, otherwise nothing comes out until you set one up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => doomed && remove(doomed.id)}>
              Remove printer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function JobTable({
  jobs,
  timezone,
  empty,
  onRetry,
  pending,
}: {
  jobs: PrintJobRow[]
  timezone: string
  empty: string
  onRetry?: (jobId: string) => void
  pending: boolean
}) {
  if (!jobs.length) {
    return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Document</TableHead>
            <TableHead>Printer</TableHead>
            <TableHead className="text-right">Tries</TableHead>
            <TableHead>Status</TableHead>
            {onRetry ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j) => {
            const s = JOB_STATUS[j.status]
            const Icon = s.icon
            return (
              <TableRow key={j.id}>
                <TableCell className="tabular-nums">
                  {formatDateTime(j.created_at, timezone)}
                </TableCell>
                <TableCell>{DOC_LABELS[j.doc]}</TableCell>
                <TableCell>{j.printers?.name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{j.attempts}</TableCell>
                <TableCell>
                  <span className={`flex items-center gap-1.5 ${s.tone}`}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {JOB_STATUS_LABELS[j.status]}
                  </span>
                  {j.error ? (
                    <span className="block text-xs text-muted-foreground">{j.error}</span>
                  ) : null}
                </TableCell>
                {onRetry ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || j.status === "claimed"}
                      onClick={() => onRetry(j.id)}
                    >
                      <RotateCcwIcon />
                      Try again
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function AgentBadge({ status }: { status: "connecting" | "connected" | "unavailable" }) {
  if (status === "connected") {
    return (
      <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <PlugIcon className="size-3.5" aria-hidden />
        Connected
      </Badge>
    )
  }
  if (status === "connecting") {
    return (
      <Badge className="border-transparent bg-muted text-muted-foreground">
        <RefreshCwIcon className="size-3.5" aria-hidden />
        Looking for the agent…
      </Badge>
    )
  }
  return (
    <Badge className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
      <PlugZapIcon className="size-3.5" aria-hidden />
      Disconnected
    </Badge>
  )
}
