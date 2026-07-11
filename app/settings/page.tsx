import { createClient } from "@/lib/supabase/server"
import { requireRole } from "@/lib/supabase/guards"
import { SettingsForm } from "@/components/settings-form"

export default async function SettingsPage() {
  const tenant = await requireRole("owner", "manager")

  const supabase = await createClient()
  const { data: settings } = await supabase
    .from("tenant_settings")
    .select("currency, timezone, service_charge, packaging_fee")
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  return (
    <div className="mx-auto w-full max-w-lg p-6 md:p-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{tenant.name} · Settings</h1>
        <p className="text-sm text-muted-foreground">
          Currency, timezone and charges. Region-configurable — nothing hardcoded.
        </p>
      </div>
      <SettingsForm
        currency={settings?.currency ?? "USD"}
        timezone={settings?.timezone ?? "UTC"}
        serviceCharge={Number(settings?.service_charge ?? 0)}
        packagingFee={Number(settings?.packaging_fee ?? 0)}
      />
    </div>
  )
}
