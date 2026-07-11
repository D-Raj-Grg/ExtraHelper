"use client"

import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { setTenantStatus } from "@/app/(app)/admin/actions"

export function TenantStatusButton({
  tenantId,
  status,
}: {
  tenantId: string
  status: string
}) {
  const [pending, startTransition] = useTransition()
  const suspended = status === "suspended"
  const next = suspended ? "activate" : "suspend"

  return (
    <Button
      size="sm"
      variant={suspended ? "default" : "destructive"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setTenantStatus(tenantId, next)
        })
      }
    >
      {pending ? "…" : suspended ? "Activate" : "Suspend"}
    </Button>
  )
}
