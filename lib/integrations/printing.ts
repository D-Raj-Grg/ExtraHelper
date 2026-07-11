/**
 * Printing adapter (rule #6). KOT + receipts render to a stack-independent job;
 * the concrete transport (local ESC/POS agent, network printer, cloud print) is
 * selected per tenant. Business logic builds jobs, never talks to a printer.
 */

export type PrintJob = {
  tenantId: string
  /** 'kot' routes to a kitchen station; 'receipt' to the cashier printer. */
  type: "kot" | "receipt"
  /** Target printer/station id (resolved from tenant config). */
  target?: string
  /** Rendered content — ESC/POS commands or a structured template payload. */
  payload: string | Record<string, unknown>
}

export type PrintResult = { status: "queued" | "printed" | "failed"; jobId: string }

export interface PrintService {
  readonly key: string
  print(job: PrintJob): Promise<PrintResult>
}

/**
 * No-op print service — accepts jobs and drops them (dev default). Swap for a
 * local-agent or cloud-print adapter per tenant once printing is configured.
 */
export const noopPrintService: PrintService = {
  key: "noop",
  async print(job: PrintJob): Promise<PrintResult> {
    return { status: "queued", jobId: `noop_${job.type}_${job.tenantId}` }
  },
}

const services = new Map<string, PrintService>([[noopPrintService.key, noopPrintService]])

export function registerPrintService(service: PrintService): void {
  services.set(service.key, service)
}

export function getPrintService(key: string | null | undefined): PrintService {
  return (key && services.get(key)) || noopPrintService
}
