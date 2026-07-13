"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { TenantSwitcher } from "@/components/tenant-switcher"
import { usePermissions } from "@/components/permission-provider"
import type { TenantMembership } from "@/lib/supabase/tenant"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  LayoutDashboardIcon,
  BellIcon,
  ReceiptIcon,
  ChefHatIcon,
  ShoppingBagIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  ArmchairIcon,
  BookOpenIcon,
  PackageIcon,
  TruckIcon,
  ChartBarIcon,
  GiftIcon,
  UsersIcon,
  CreditCardIcon,
  ScrollTextIcon,
  Settings2Icon,
  CommandIcon,
} from "lucide-react"

// nav item title → permission key required to see it (missing → always visible).
const NAV_PERM: Record<string, string> = {
  Dashboard: "dashboard.view",
  Notifications: "notifications.view",
  "New Order": "order.view",
  "Kitchen (KDS)": "kds.view",
  "Online Orders": "online.view",
  "Cash Drawer": "cash.view",
  Inventory: "inventory.view",
  Purchasing: "purchasing.view",
  Reports: "reports.view",
  Loyalty: "loyalty.view",
  Menu: "menu.view",
  "Floors & Tables": "tables.view",
  Reservations: "reservations.view",
  Team: "staff.view",
  Billing: "billing.view",
  "Audit Log": "audit.view",
  Settings: "settings.view",
}

const data = {
  user: {
    name: "",
    email: "",
    avatar: "",
  },
  // Shown ungrouped at the top of the sidebar.
  navTop: [
    { title: "Dashboard", url: "/", icon: <LayoutDashboardIcon /> },
    { title: "Notifications", url: "/notifications", icon: <BellIcon /> },
  ],
  // Labeled sections, in order.
  navGroups: [
    {
      label: "Operations",
      items: [
        { title: "New Order", url: "/pos", icon: <ReceiptIcon /> },
        { title: "Kitchen (KDS)", url: "/kds", icon: <ChefHatIcon /> },
        { title: "Online Orders", url: "/online", icon: <ShoppingBagIcon /> },
        { title: "Cash Drawer", url: "/cash", icon: <BanknoteIcon /> },
        { title: "Reservations", url: "/reservations", icon: <CalendarCheckIcon /> },
        { title: "Floors & Tables", url: "/tables", icon: <ArmchairIcon /> },
      ],
    },
    {
      label: "Catalog",
      items: [
        { title: "Menu", url: "/menu", icon: <BookOpenIcon /> },
        { title: "Inventory", url: "/inventory", icon: <PackageIcon /> },
        { title: "Purchasing", url: "/purchasing", icon: <TruckIcon /> },
      ],
    },
    {
      label: "Insights",
      items: [
        { title: "Reports", url: "/reports", icon: <ChartBarIcon /> },
        { title: "Loyalty", url: "/loyalty", icon: <GiftIcon /> },
      ],
    },
  ],
  // Admin cluster, pinned to the bottom.
  navSecondary: [
    { title: "Team", url: "/team", icon: <UsersIcon /> },
    { title: "Billing", url: "/billing", icon: <CreditCardIcon /> },
    { title: "Audit Log", url: "/audit", icon: <ScrollTextIcon /> },
    { title: "Settings", url: "/settings", icon: <Settings2Icon /> },
  ],
}

export function AppSidebar({
  user,
  tenants,
  activeTenantId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user?: { name: string; email: string; avatar: string }
  tenants?: TenantMembership[]
  activeTenantId?: string
}) {
  const perms = usePermissions()
  const canSee = (title: string) => {
    const p = NAV_PERM[title]
    return !p || perms.has(p)
  }
  const navTop = data.navTop.filter((i) => canSee(i.title))
  const navGroups = data.navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i.title)) }))
    .filter((g) => g.items.length > 0)
  const navSecondary = data.navSecondary.filter((i) => canSee(i.title))
  const multiTenant = (tenants?.length ?? 0) > 1
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {multiTenant && activeTenantId ? (
          <TenantSwitcher tenants={tenants!} activeId={activeTenantId} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="data-[slot=sidebar-menu-button]:p-1.5!"
                render={<a href="/" />}
              >
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">
                  {tenants?.[0]?.name ?? "ExtraHelper"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navTop} groups={navGroups} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user ?? data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
