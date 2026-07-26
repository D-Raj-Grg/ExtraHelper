"use client"

import { useState, useTransition } from "react"
import {
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
  PlugIcon,
  PlugZapIcon,
  PlusIcon,
  PrinterIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { deletePrinter } from "@/app/(app)/settings/printers-actions"
import { formatDateTime } from "@/lib/format"
import {
  CONNECTION_LABELS,
  JOB_TYPE_LABELS,
  ROLE_LABELS,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import type { PrinterRow, PrintJobRow } from "./types"

const AGENT_DOWNLOAD = "https://qz.io/download/"

/** Status meaning carried by icon + words; colour only reinforces it. */
const JOB_STATUS = {
  printed: { icon: CheckCircle2Icon, label: "Printed", tone: "text-emerald-700 dark:text-emerald-400" },
  queued: { icon: ClockIcon, label: "Queued", tone: "text-amber-700 dark:text-amber-400" },
  failed: { icon: TriangleAlertIcon, label: "Failed", tone: "text-destructive" },
} as const

export function PrintersTab({
  printers,
  jobs,
  timezone,
}: {
  printers: PrinterRow[]
  jobs: PrintJobRow[]
  timezone: string
}) {
  // Held by id, not by object — the row is derived from the live list so a
  // revalidate shows through without closing the sheet.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { agentStatus, printTest, printKot, printBill } = usePrint()

  const editing = printers.find((p) => p.id === editingId) ?? null
  const doomed = printers.find((p) => p.id === confirmDelete) ?? null

  function remove(id: string) {
    startTransition(async () => {
      const res = await deletePrinter(id)
      if (res && "error" in res) toast.error(res.error)
      else toast.success("Printer removed.")
      setConfirmDelete(null)
    })
  }

  function reprint(job: PrintJobRow) {
    startTransition(async () => {
      if (job.kot_id) await printKot(job.kot_id, { reprint: true })
      else if (job.bill_id) await printBill(job.bill_id)
      else if (job.printer_id) await printTest(job.printer_id)
      else toast.info("Nothing left to re-print — the document is gone.")
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <AgentCard status={agentStatus} />

      <Card>
        <CardHeader>
          <CardTitle>Printers</CardTitle>
          <CardDescription>
            Where tickets and receipts come out. Kitchen tickets follow the station they
            belong to; receipts go to the printer marked for receipts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {printers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <PrinterIcon className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 font-medium">No printers yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your thermal printer and tickets stop opening in browser tabs. Until
                then, printing still works — it just needs a click each time.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Paper</TableHead>
                    <TableHead>Prints</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.name}
                        {p.is_default ? (
                          <Badge className="ml-2 border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400">
                            Default
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{CONNECTION_LABELS[p.connection]}</TableCell>
                      <TableCell className="tabular-nums">{printerTarget(p)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.paper_width}mm</TableCell>
                      <TableCell>{ROLE_LABELS[p.role]}</TableCell>
                      <TableCell>
                        {p.is_active ? (
                          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
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
                            Test print
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

          <div>
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <PlusIcon />
              Add printer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent print jobs</CardTitle>
          <CardDescription>
            The last 20 tickets and receipts. Anything that failed can be sent again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing printed yet. Fire an order, or use Test print above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Printer</TableHead>
                    <TableHead className="text-right">Tries</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell>{JOB_TYPE_LABELS[j.type] ?? j.type}</TableCell>
                        <TableCell>{j.printers?.name ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{j.attempts}</TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-1.5 ${s.tone}`}>
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {s.label}
                          </span>
                          {j.error ? (
                            <span className="block text-xs text-muted-foreground">{j.error}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => reprint(j)}
                          >
                            Print again
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PrinterSheet
        printer={editing}
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditingId(null)
          }
        }}
      />

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
              Stations pointing at this printer lose their route. Their tickets fall back to
              the default printer, or to a browser tab if there isn&apos;t one. Nothing already
              printed changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => doomed && remove(doomed.id)}
            >
              Remove printer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Live agent state — the difference between silent printing and a dialog. */
function AgentCard({ status }: { status: "connecting" | "connected" | "unavailable" }) {
  const { reconnect } = usePrintAgent()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Print agent</CardTitle>
        <CardDescription>
          A small app on this computer that sends tickets straight to the printer, with no
          print dialog in the way.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {status === "connected" ? (
          <Badge className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
            <PlugIcon className="size-3.5" aria-hidden />
            Connected
          </Badge>
        ) : status === "connecting" ? (
          <Badge className="border-transparent bg-muted text-muted-foreground">
            <RefreshCwIcon className="size-3.5" aria-hidden />
            Looking for the agent…
          </Badge>
        ) : (
          <Badge className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <PlugZapIcon className="size-3.5" aria-hidden />
            Not connected
          </Badge>
        )}
        <p className="text-sm text-muted-foreground">
          {status === "connected"
            ? "Tickets print straight to the printer."
            : "Printing still works — tickets open in a browser tab for you to print."}
        </p>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={reconnect}>
            <RefreshCwIcon />
            Retry
          </Button>
          <Button type="button" variant="outline" size="sm" render={<a href={AGENT_DOWNLOAD} target="_blank" rel="noreferrer" />}>
            <DownloadIcon />
            Get the agent
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
