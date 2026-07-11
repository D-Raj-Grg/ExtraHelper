import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { SettingsForm } from "@/components/settings-form"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function SettingsPage() {
  const tenant = await requireRole("owner", "manager")

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("currency, timezone, service_charge, packaging_fee, tax_rules, receipt_template")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  const taxRules = Array.isArray(settings?.tax_rules)
    ? (settings.tax_rules as { name?: string; rate?: number; inclusive?: boolean }[]).map((r) => ({
        name: String(r?.name ?? ""),
        rate: Number(r?.rate ?? 0),
        inclusive: Boolean(r?.inclusive),
      }))
    : []
  const receipt = (settings?.receipt_template ?? {}) as {
    header?: string
    footer?: string
    terms?: string
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        title={<>{tenant.name} · Settings</>}
        description="Currency, timezone and charges. Region-configurable — nothing hardcoded."
      />
      <SettingsForm
        currency={settings?.currency ?? "USD"}
        timezone={settings?.timezone ?? "UTC"}
        serviceCharge={Number(settings?.service_charge ?? 0)}
        packagingFee={Number(settings?.packaging_fee ?? 0)}
        taxRules={taxRules}
        receipt={{
          header: receipt.header ?? "",
          footer: receipt.footer ?? "",
          terms: receipt.terms ?? "",
        }}
      />
    </PageShell>
  )
}
