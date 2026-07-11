import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { SettingsForm } from "@/components/settings-form"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function SettingsPage() {
  const tenant = await requireRole("owner", "manager")

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("currency, timezone, service_charge, packaging_fee")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

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
      />
    </PageShell>
  )
}
