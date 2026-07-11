"use client"

import { useTransition } from "react"
import { setTenantPlan } from "@/app/admin/actions"

export function AdminPlanSelect({
  tenantId,
  currentCode,
  plans,
}: {
  tenantId: string
  currentCode: string | null
  plans: { code: string; name: string }[]
}) {
  const [pending, startTransition] = useTransition()

  return (
    <select
      defaultValue={currentCode ?? ""}
      disabled={pending}
      onChange={(e) => {
        const code = e.target.value
        if (code) startTransition(async () => { await setTenantPlan(tenantId, code) })
      }}
      className="border-input dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-xs"
    >
      <option value="">— no plan —</option>
      {plans.map((p) => (
        <option key={p.code} value={p.code}>
          {p.name}
        </option>
      ))}
    </select>
  )
}
