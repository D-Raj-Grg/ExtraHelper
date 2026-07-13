import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { SettingsForm } from "@/components/settings-form"
import { PageShell, PageHeader } from "@/components/page-header"

export default async function SettingsPage() {
  const tenant = await requirePermission("settings.view")

  const supabase = await createClient()
  const [{ data: settings }, { data: branches }] = await Promise.all([
    supabase
      .from("tenant_settings")
      .select(
        "currency, timezone, service_charge, packaging_fee, tax_rules, receipt_template, block_negative_stock, payment_gateway",
      )
      .eq("tenant_id", tenant.tenantId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name, address, is_default")
      .eq("tenant_id", tenant.tenantId)
      .order("is_default", { ascending: false })
      .order("name"),
  ])

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
    logo_url?: string
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
        blockNegativeStock={Boolean(settings?.block_negative_stock)}
        paymentGateway={settings?.payment_gateway ?? "sandbox"}
        logoUrl={receipt.logo_url ?? null}
        branches={branches ?? []}
        canManageBranches={tenant.role === "owner" || tenant.role === "manager"}
      />
    </PageShell>
  )
}
