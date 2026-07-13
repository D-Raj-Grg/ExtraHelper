"use client"

import { useTransition } from "react"
import { setTenantPlan } from "@/app/(app)/admin/actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
    <Select
      defaultValue={currentCode ?? ""}
      disabled={pending}
      onValueChange={(v) => {
        const code = v
        if (code) startTransition(async () => { await setTenantPlan(tenantId, code) })
      }}
    >
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">— no plan —</SelectItem>
        {plans.map((p) => (
          <SelectItem key={p.code} value={p.code}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
