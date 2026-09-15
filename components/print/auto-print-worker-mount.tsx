import { AutoPrintWorker } from "@/components/print/auto-print-worker"
import { createClient } from "@/lib/supabase/server"

/**
 * Reads the tenant's printing mode and mounts the worker. Split out of the app
 * layout so its query streams instead of holding up first paint — the worker
 * renders nothing, so arriving a beat late costs nothing visible, and it starts
 * draining the queue as soon as it mounts.
 *
 * In cloud mode the headless agent owns the print queue and browsers stay out
 * of it, so the worker is not mounted at all.
 */
export async function AutoPrintWorkerMount({ tenantId }: { tenantId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("tenant_settings")
    .select("printing_mode")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  const mode = data?.printing_mode === "cloud" ? "cloud" : "local"
  return <AutoPrintWorker tenantId={tenantId} branchId={null} mode={mode} />
}
