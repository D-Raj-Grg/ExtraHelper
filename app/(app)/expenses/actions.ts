"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/supabase/guards"
import { PAID_FROM, type PaidFrom } from "@/lib/expense-constants"

export type ExpenseState = { error: string } | { ok: true } | undefined

// Permission checks live in the RPCs (expenses.create / .manage, reports.view);
// these actions only shape input and surface the database's answer.

function cents(raw: FormDataEntryValue | null): number {
  return Math.round(Number(raw ?? 0) * 100)
}

function paidFrom(raw: FormDataEntryValue | null): PaidFrom | null {
  const v = String(raw ?? "")
  return (PAID_FROM as readonly string[]).includes(v) ? (v as PaidFrom) : null
}

const RECEIPT_BUCKET = "expense-receipts"
const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
}

type Client = Awaited<ReturnType<typeof createClient>>

/** A usable photo from the form, or null when none was chosen. */
function receiptFile(raw: FormDataEntryValue | null): File | null {
  return raw instanceof File && raw.size > 0 ? raw : null
}

function receiptProblem(file: File): string | null {
  if (!RECEIPT_TYPES[file.type]) return "Receipt must be a photo (JPG, PNG, WebP or HEIC)."
  if (file.size > 5 * 1024 * 1024) return "Receipt photo must be under 5 MB."
  return null
}

/**
 * Upload under a fresh name, link it, then delete whatever it replaced. The
 * link is the RPC's job — it re-checks who may change this expense and that the
 * path really sits under it — so storage and the row can't disagree.
 */
async function attachReceipt(
  supabase: Client,
  tenantId: string,
  expenseId: string,
  file: File,
): Promise<string | null> {
  const problem = receiptProblem(file)
  if (problem) return problem
  const path = `${tenantId}/${expenseId}/${crypto.randomUUID()}.${RECEIPT_TYPES[file.type]}`
  const { error: upErr } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { contentType: file.type })
  if (upErr) return upErr.message

  const { data: previous, error } = await supabase.rpc("set_expense_receipt", {
    _id: expenseId,
    _path: path,
  })
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path])
    return error.message
  }
  if (previous) await supabase.storage.from(RECEIPT_BUCKET).remove([previous])
  return null
}

function refresh() {
  revalidatePath("/expenses")
  revalidatePath("/reports/day")
}

export async function recordExpense(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const tenant = await requireTenant()
  const amount = cents(formData.get("amount"))
  const category = String(formData.get("category") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const from = paidFrom(formData.get("paidFrom"))
  const date = String(formData.get("date") ?? "") || null
  const clientKey = String(formData.get("clientKey") ?? "") || null

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above zero." }
  if (!category) return { error: "Pick a category." }
  if (!note) return { error: "Say what it was for — “rice”, “ride for dishwasher”." }
  if (!from) return { error: "Say where the money came from." }
  const photo = receiptFile(formData.get("receipt"))
  const photoProblem = photo ? receiptProblem(photo) : null
  if (photoProblem) return { error: photoProblem }

  const supabase = await createClient()
  const { data: expenseId, error } = await supabase.rpc("record_expense", {
    _tenant: tenant.tenantId,
    _category: category,
    _amount_cents: amount,
    _note: note,
    _paid_from: from,
    ...(date ? { _business_date: date } : {}),
    ...(clientKey ? { _client_key: clientKey } : {}),
  })
  if (error) return { error: error.message }

  // The expense stands on its own; a failed photo is reported, not rolled back.
  if (photo && expenseId) {
    const photoError = await attachReceipt(supabase, tenant.tenantId, expenseId, photo)
    if (photoError) {
      refresh()
      return { error: `Expense saved, but the receipt didn't upload: ${photoError}` }
    }
  }

  refresh()
  return { ok: true }
}

/** Attach or replace the receipt photo on an existing expense. */
export async function uploadExpenseReceipt(formData: FormData): Promise<ExpenseState> {
  const tenant = await requireTenant()
  const id = String(formData.get("id") ?? "")
  const photo = receiptFile(formData.get("receipt"))
  if (!id) return { error: "Nothing to attach to." }
  if (!photo) return { error: "Choose a photo." }
  const supabase = await createClient()
  const problem = await attachReceipt(supabase, tenant.tenantId, id, photo)
  if (problem) return { error: problem }
  refresh()
  return { ok: true }
}

export async function removeExpenseReceipt(id: string): Promise<ExpenseState> {
  await requireTenant()
  const supabase = await createClient()
  const { data: previous, error } = await supabase.rpc("set_expense_receipt", {
    _id: id,
    // Null clears the link; the generated type says string.
    _path: null as unknown as string,
  })
  if (error) return { error: error.message }
  if (previous) await supabase.storage.from(RECEIPT_BUCKET).remove([previous])
  refresh()
  return { ok: true }
}

export async function updateExpense(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  await requireTenant()
  const id = String(formData.get("id") ?? "")
  const amount = cents(formData.get("amount"))
  const category = String(formData.get("category") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const from = paidFrom(formData.get("paidFrom"))

  if (!id) return { error: "Nothing to update." }
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above zero." }
  if (!category) return { error: "Pick a category." }
  if (!note) return { error: "Say what it was for." }
  if (!from) return { error: "Say where the money came from." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_expense", {
    _id: id,
    _category: category,
    _amount_cents: amount,
    _note: note,
    _paid_from: from,
  })
  if (error) return { error: error.message }

  refresh()
  return { ok: true }
}

export async function voidExpense(id: string, reason: string): Promise<ExpenseState> {
  await requireTenant()
  if (!reason.trim()) return { error: "Give a reason — it goes in the audit log." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("void_expense", {
    _id: id,
    _reason: reason.trim(),
  })
  if (error) return { error: error.message }
  refresh()
  return { ok: true }
}

export async function saveExpenseCategory(id: string | null, name: string): Promise<ExpenseState> {
  const tenant = await requireTenant()
  if (!name.trim()) return { error: "Give the category a name." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("upsert_expense_category", {
    _tenant: tenant.tenantId,
    // The RPC treats null as "create"; the generated type says string.
    _id: id as string,
    _name: name.trim(),
  })
  if (error) return { error: error.message }
  refresh()
  return { ok: true }
}

export async function archiveExpenseCategory(id: string): Promise<ExpenseState> {
  const tenant = await requireTenant()
  const supabase = await createClient()
  const { error } = await supabase.rpc("archive_expense_category", {
    _tenant: tenant.tenantId,
    _id: id,
  })
  if (error) return { error: error.message }
  refresh()
  return { ok: true }
}

/** The night count: cash left in hand and online received, against expected. */
export async function closeDay(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const tenant = await requireTenant()
  const day = String(formData.get("day") ?? "")
  const cash = cents(formData.get("cash"))
  const onlineRaw = String(formData.get("online") ?? "").trim()
  const online = onlineRaw === "" ? null : cents(onlineRaw)
  const note = String(formData.get("note") ?? "").trim()

  if (!day) return { error: "No day selected." }
  if (!Number.isFinite(cash) || cash < 0) return { error: "Cash counted must be zero or more." }
  if (online !== null && (!Number.isFinite(online) || online < 0))
    return { error: "Online received must be zero or more." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("close_day", {
    _tenant: tenant.tenantId,
    _day: day,
    _cash_counted_cents: cash,
    ...(online !== null ? { _online_counted_cents: online } : {}),
    ...(note ? { _note: note } : {}),
  })
  if (error) return { error: error.message }

  refresh()
  return { ok: true }
}
