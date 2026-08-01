"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  claimPrintJobs,
  completePrintJob,
  renderPrintJob,
  savePrinterUsbPath,
} from "@/app/(app)/print/actions"
import { createClient } from "@/lib/supabase/client"
import { usePrintAgent } from "./print-provider"

/**
 * Drains the print queue from this browser.
 *
 * Mounted once for the whole authenticated app, so any open screen — POS, KDS,
 * the floor map — is enough to keep the printers fed. Jobs are *claimed*
 * before they are sent (`for update skip locked` in `claim_print_jobs`), which
 * is what stops two open tabs printing the same ticket twice.
 *
 * Renders nothing, and never throws into the page: a printer that is out of
 * paper must not take the POS down with it.
 */
export function AutoPrintWorker({
  tenantId,
  branchId,
  /** In cloud mode the headless agent owns the queue and browsers stay out. */
  mode,
}: {
  tenantId: string
  branchId: string | null
  mode: "local" | "cloud"
}) {
  const { connected, send } = usePrintAgent()
  // A stable name per tab, so `claimed_by` says something useful when a job is
  // stuck and someone is looking at the job list wondering which till has it.
  const claimer = useRef<string | null>(null)
  const draining = useRef(false)

  const drain = useCallback(async () => {
    // One drain at a time: a realtime burst of six station tickets must not
    // start six overlapping claims that fight over the same rows.
    if (draining.current) return
    draining.current = true
    // Named on first use rather than during render — a ref read in the render
    // body is exactly the thing that stops a component updating as expected.
    claimer.current ??= `tab-${Math.random().toString(36).slice(2, 8)}`
    try {
      for (let round = 0; round < 5; round++) {
        const jobs = await claimPrintJobs(claimer.current, branchId, 5)
        if (!jobs.length) return

        for (const job of jobs) {
          try {
            const prepared = await renderPrintJob(job.id)
            if ("error" in prepared) {
              await completePrintJob(job.id, "failed", prepared.error)
              toast.error(prepared.error)
              continue
            }
            if (!prepared.printer) {
              await completePrintJob(job.id, "failed", "no printer")
              continue
            }

            const usbPath = await send(prepared.printer, prepared.payload, prepared.copies)
            if (usbPath) {
              // Discovered on the wire; cache it so the next ticket skips the
              // interface and endpoint scan.
              void savePrinterUsbPath(prepared.printer.id, usbPath.iface, usbPath.endpoint)
            }
            await completePrintJob(job.id, "printed")
            toast.success(`Printed · ${prepared.label}`)
          } catch (e) {
            // Agent reachable but the printer refused — out of paper, wrong IP,
            // switched off. The job stays visible and retryable in Settings.
            const message = e instanceof Error ? e.message : "Print failed"
            await completePrintJob(job.id, "failed", message)
            toast.error(`Could not print — ${message}`)
          }
        }
      }
    } catch {
      // Claiming failed (offline, session expired). The next tick tries again.
    } finally {
      draining.current = false
    }
  }, [branchId, send])

  useEffect(() => {
    if (mode !== "local" || !connected) return

    void drain()

    const supabase = createClient()
    const channel = supabase
      .channel(`print-jobs:${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "print_jobs",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => void drain(),
      )
      .subscribe()

    // Realtime is the fast path, not the guarantee. A dropped socket or a job
    // re-queued after a stale claim would otherwise sit there forever.
    const timer = setInterval(() => void drain(), 20_000)

    return () => {
      clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [connected, drain, mode, tenantId])

  return null
}
