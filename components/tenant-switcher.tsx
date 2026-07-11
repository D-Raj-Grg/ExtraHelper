"use client"

import { useTransition } from "react"
import { CheckIcon, ChevronsUpDownIcon, StoreIcon } from "lucide-react"
import { switchTenant } from "@/app/(app)/tenant-actions"
import type { TenantMembership } from "@/lib/supabase/tenant"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

/**
 * Sidebar-header restaurant picker for users who belong to more than one
 * tenant. Selecting one persists via `switchTenant` (cookie) and reloads.
 */
export function TenantSwitcher({
  tenants,
  activeId,
}: {
  tenants: TenantMembership[]
  activeId: string
}) {
  const [pending, startTransition] = useTransition()
  const active = tenants.find((t) => t.tenantId === activeId) ?? tenants[0]

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
              <StoreIcon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{active?.name}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">{active?.role}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56" sideOffset={4}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Restaurants
            </DropdownMenuLabel>
            {tenants.map((t) => (
              <DropdownMenuItem
                key={t.tenantId}
                disabled={pending}
                onClick={() => {
                  if (t.tenantId !== activeId)
                    startTransition(() => {
                      void switchTenant(t.tenantId)
                    })
                }}
              >
                <StoreIcon className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{t.name}</span>
                {t.tenantId === activeId ? <CheckIcon className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
