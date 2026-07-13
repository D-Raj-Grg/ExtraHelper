import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { formatDateTime } from "@/lib/format"
import { ACTION_STYLES } from "@/lib/audit-constants"
import { PageShell, PageHeader } from "@/components/page-header"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"

export const dynamic = "force-dynamic"

type Row = {
  id: string
  action: string
  entity_type: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export default async function AuditPage() {
  const tenant = await requirePermission("audit.view")
  const supabase = await createClient()

  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, metadata, created_at")
    .eq("tenant_id", tenant.tenantId)
    .order("created_at", { ascending: false })
    .limit(100)

  const rows = (data ?? []) as Row[]

  return (
    <PageShell>
      <PageHeader
        title={<>{tenant.name} · Audit Log</>}
        description={<>Sensitive actions — voids, discounts, refunds, plan &amp; status changes.</>}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audited actions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="w-full text-sm">
            <TableHeader className="bg-muted/50 text-left">
              <TableRow>
                <TableHead className="px-3 py-2 font-medium">When</TableHead>
                <TableHead className="px-3 py-2 font-medium">Action</TableHead>
                <TableHead className="px-3 py-2 font-medium">Entity</TableHead>
                <TableHead className="px-3 py-2 font-medium">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="border-t align-top">
                  <TableCell className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(r.created_at, tenant.timezone)}
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[r.action] ?? "bg-muted"}`}>
                      {r.action.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-muted-foreground">{r.entity_type ?? "—"}</TableCell>
                  <TableCell className="px-3 py-2 text-xs text-muted-foreground">
                    {r.metadata && Object.keys(r.metadata).length > 0
                      ? Object.entries(r.metadata)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(" · ")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  )
}
