import { toast } from "sonner"
import { recordPrintJob } from "@/app/(app)/print/actions"
import type { PreparedPrintJob, PrinterRef } from "./types"

/**
 * Client-side print dispatch: hand a prepared job to the local agent, or fall
 * back to the browser print page.
 *
 * Printing must never block a fire. Every failure path here ends in paper — or
 * at worst a toast telling staff exactly what to do — never a thrown error
 * bubbling into the POS.
 */

export type SendRaw = (printer: PrinterRef, dataBase64: string) => Promise<void>

export type DispatchOptions = {
  /** From `usePrintAgent()`. */
  connected: boolean
  sendRaw: SendRaw
  /** Suppress the success toast when firing several tickets at once. */
  quiet?: boolean
}

export type DispatchOutcome = "agent" | "browser" | "failed"

export async function dispatchJob(
  job: PreparedPrintJob,
  { connected, sendRaw, quiet }: DispatchOptions,
): Promise<DispatchOutcome> {
  if (connected && job.printer) {
    try {
      await sendRaw(job.printer, job.dataBase64)
      void recordPrintJob(job.jobId, "printed")
      if (!quiet) toast.success(`Printed · ${job.label}`)
      return "agent"
    } catch (e) {
      // Agent reachable but the printer refused — out of paper, wrong IP, off.
      const message = e instanceof Error ? e.message : "Print failed"
      void recordPrintJob(job.jobId, "failed", message)
      if (openFallback(job)) {
        toast.warning(`${job.label} — printer unreachable, opened in browser instead`)
        return "browser"
      }
      toast.error(`${job.label} — ${message}`)
      return "failed"
    }
  }

  // No agent (or no printer configured): the pre-existing browser path.
  if (openFallback(job)) {
    void recordPrintJob(job.jobId, "failed", connected ? "no printer configured" : "agent offline")
    return "browser"
  }

  void recordPrintJob(job.jobId, "failed", "no printer and no fallback")
  toast.error(
    job.printer
      ? `${job.label} — print agent not connected.`
      : `${job.label} — no printer set up yet. Add one in Settings → Printers.`,
  )
  return "failed"
}

/** Opens the browser-print page. False when the job has no printable page. */
function openFallback(job: PreparedPrintJob): boolean {
  if (!job.fallbackUrl) return false
  window.open(job.fallbackUrl, "_blank", "noopener")
  return true
}
