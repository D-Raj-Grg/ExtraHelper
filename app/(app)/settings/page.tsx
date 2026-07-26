import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { SettingsManager } from "@/components/settings/settings-manager"
import { PageShell, PageHeader } from "@/components/page-header"
import type {
  DangerData,
  PrinterRow,
  PrintJobRow,
  TransferMember,
} from "@/components/settings/types"

export default async function SettingsPage() {
  const tenant = await requirePermission("settings.view")
  const isOwner = tenant.role === "owner"

  const supabase = await createClient()
  const [{ data: settings }, { data: branches }, { data: printers }, { data: printJobs }] =
    await Promise.all([
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
    supabase
      .from("printers")
      .select(
        "id, name, connection, host, port, system_name, paper_width, role, is_default, is_active",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("is_default", { ascending: false })
      .order("name"),
    // Enough history to spot a printer that keeps failing, not an audit trail.
    supabase
      .from("print_jobs")
      .select(
        "id, type, status, attempts, error, created_at, kot_id, bill_id, printer_id, printers(name)",
      )
      .eq("tenant_id", tenant.tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  // Owner-only Dangerous Area: usage counts, plan denominators, transfer
  // candidates and any pending deletion. Skipped entirely for non-owners.
  let danger: DangerData | null = null
  if (isOwner) {
    const [
      { count: customers },
      { count: tables },
      { count: staff },
      { count: menuItems },
      { data: sub },
      { data: memberRows },
      { data: tenantRow },
    ] = await Promise.all([
      supabase.from("customers").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.tenantId),
      supabase.from("restaurant_tables").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.tenantId),
      supabase
        .from("user_tenants")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant.tenantId)
        .eq("status", "active"),
      supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("tenant_id", tenant.tenantId),
      supabase
        .from("subscriptions")
        .select("status, plan:plans(name, limits)")
        .eq("tenant_id", tenant.tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("list_tenant_members", { _tenant: tenant.tenantId }),
      supabase.from("tenants").select("deletion_scheduled_at").eq("id", tenant.tenantId).maybeSingle(),
    ])

    const plan = (sub?.plan ?? null) as { name?: string; limits?: Record<string, number> } | null
    const isTrial = sub?.status === "trialing" || !sub
    // No subscription yet → plain "Trial"; on-trial with a named plan → "Pro Trial".
    const planLabel = plan?.name ? (isTrial ? `${plan.name} Trial` : plan.name) : "Trial"
    // Trial unlocks everything → show counts without a ceiling.
    const lim = isTrial ? {} : (plan?.limits ?? {})
    const cap = (k: string): number | null =>
      typeof lim[k] === "number" ? (lim[k] as number) : null

    const members: TransferMember[] = ((memberRows ?? []) as {
      user_id: string | null
      email: string
      base_role: string
      role_name: string | null
      status: string
    }[])
      .filter((m) => m.user_id && m.status === "active" && m.base_role !== "owner")
      .map((m) => ({ userId: m.user_id as string, email: m.email, roleName: m.role_name }))

    danger = {
      planLabel,
      usage: {
        customers: customers ?? 0,
        tables: tables ?? 0,
        staff: staff ?? 0,
        menuItems: menuItems ?? 0,
      },
      limits: {
        customers: cap("customers"),
        tables: cap("tables"),
        staff: cap("staff"),
        menuItems: cap("menu_items"),
      },
      members,
      deletionScheduledAt: (tenantRow?.deletion_scheduled_at as string | null) ?? null,
    }
  }

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
    <PageShell width="standard">
      <PageHeader
        title="Settings"
        description={`How ${tenant.name} handles money, tax, receipts and locations. Region-configurable — nothing hardcoded.`}
      />
      <SettingsManager
        restaurantName={tenant.name}
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
        printers={(printers ?? []) as unknown as PrinterRow[]}
        printJobs={(printJobs ?? []) as unknown as PrintJobRow[]}
        canManagePrinters={tenant.role === "owner" || tenant.role === "manager"}
        danger={danger}
      />
    </PageShell>
  )
}
