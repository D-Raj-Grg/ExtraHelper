import { createClient } from "@/lib/supabase/server"
import { requirePermission } from "@/lib/supabase/guards"
import { getMyPermissions } from "@/lib/supabase/permissions"
import { PageShell, PageHeader } from "@/components/page-header"
import { ExpensesBoard } from "@/components/expenses/expenses-board"
import { CategoryManager } from "@/components/expenses/category-manager"
import {
  RECEIPT_URL_TTL_SECONDS,
  type ExpenseCategory,
  type ExpenseRow,
  type PaidFrom,
} from "@/lib/expense-constants"
import { businessDay } from "@/lib/format"
import { isYmd } from "@/lib/report-range"

export const dynamic = "force-dynamic"

/**
 * The daily book: every small spend through the day — rice, gas, a ride home
 * for the dishwasher — logged by whoever paid it, totalled for the night count
 * on Day close. Works with the cash drawer off, which is how most small
 * restaurants run.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const sp = await searchParams
  const tenant = await requirePermission("expenses.create")
  const today = businessDay(new Date(), tenant.timezone, tenant.dayCutoffMinutes)
  const date = isYmd(sp.date) && sp.date <= today ? sp.date : today

  const supabase = await createClient()
  const [
    permissionKeys,
    {
      data: { user },
    },
    { data: cats },
    { data: rows },
  ] = await Promise.all([
    getMyPermissions(tenant.tenantId),
    supabase.auth.getUser(),
    supabase
      .from("expense_categories")
      .select("id, name, sort, archived_at")
      .eq("tenant_id", tenant.tenantId)
      .order("sort")
      .order("name"),
    // RLS narrows this to the caller's own rows unless they hold expenses.view.
    supabase
      .from("expenses")
      .select(
        "id, category_id, amount_cents, note, paid_from, created_at, created_by, voided_at, void_reason, receipt_path",
      )
      .eq("tenant_id", tenant.tenantId)
      .eq("business_date", date)
      .order("created_at", { ascending: false }),
  ])

  const canViewAll = permissionKeys.includes("expenses.view")
  const canManage = permissionKeys.includes("expenses.manage")
  const canCloseDay = permissionKeys.includes("reports.view")

  const categories: ExpenseCategory[] = (cats ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    archived: c.archived_at !== null,
  }))
  const catName = new Map(categories.map((c) => [c.id, c.name]))

  // created_by points at auth.users, which PostgREST can't join to profiles.
  const raw = rows ?? []
  const personIds = [...new Set(raw.map((r) => r.created_by))]
  const { data: profiles } = personIds.length
    ? await supabase.from("profiles").select("id, full_name, username").in("id", personIds)
    : { data: [] }
  // The bucket is private: sign every photo on the page in one call.
  const paths = raw.map((r) => r.receipt_path).filter((p): p is string => !!p)
  const { data: signed } = paths.length
    ? await supabase.storage.from("expense-receipts").createSignedUrls(paths, RECEIPT_URL_TTL_SECONDS)
    : { data: [] }
  const urlByPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]))

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, p.full_name || (p.username ? `@${p.username}` : null)]),
  )

  const expenses: ExpenseRow[] = raw.map((r) => ({
    id: r.id,
    category_id: r.category_id,
    category: catName.get(r.category_id) ?? "—",
    amount_cents: r.amount_cents,
    note: r.note,
    paid_from: r.paid_from as PaidFrom,
    created_at: r.created_at,
    created_by: r.created_by,
    by: nameById.get(r.created_by) ?? null,
    voided: r.voided_at !== null,
    void_reason: r.void_reason,
    editable: canManage || (r.created_by === user?.id && date === today),
    receipt_url: r.receipt_path ? (urlByPath.get(r.receipt_path) ?? null) : null,
    can_attach: canManage || r.created_by === user?.id,
  }))

  return (
    <PageShell>
      <PageHeader
        title="Expenses"
        description={
          canViewAll
            ? `${tenant.name}'s daily book — every small spend, totalled for the night count.`
            : "Log what you spent for the restaurant. You see your own entries; a manager sees them all."
        }
        actions={canManage ? <CategoryManager categories={categories} /> : null}
      />
      <ExpensesBoard
        date={date}
        today={today}
        currency={tenant.currency}
        timezone={tenant.timezone}
        categories={categories.filter((c) => !c.archived)}
        expenses={expenses}
        canBackdate={canManage}
        canViewAll={canViewAll}
        canCloseDay={canCloseDay}
      />
    </PageShell>
  )
}
