"use client"

import * as React from "react"

import { SidebarNavLink, useActiveUrl } from "@/components/nav-link"
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
  WalletIcon,
  CalendarCheckIcon,
  ArmchairIcon,
  BookOpenIcon,
  PackageIcon,
  TruckIcon,
  ChartBarIcon,
  GiftIcon,
  TicketPercentIcon,
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
  Expenses: "expenses.create",
  Inventory: "inventory.view",
  Purchasing: "purchasing.view",
  Reports: "reports.view",
  "Day close": "reports.view",
  Loyalty: "loyalty.view",
  Coupons: "coupons.view",
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
        { title: "POS", url: "/pos", icon: <ReceiptIcon /> },
        { title: "Kitchen (KDS)", url: "/kds", icon: <ChefHatIcon /> },
        { title: "Online Orders", url: "/online", icon: <ShoppingBagIcon /> },
        { title: "Expenses", url: "/expenses", icon: <WalletIcon /> },
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
        { title: "Day close", url: "/reports/day", icon: <CalendarCheckIcon /> },
        { title: "Loyalty", url: "/loyalty", icon: <GiftIcon /> },
        { title: "Coupons", url: "/coupons", icon: <TicketPercentIcon /> },
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
  cashDrawerEnabled = false,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user?: { name: string; email: string; avatar: string }
  tenants?: TenantMembership[]
  activeTenantId?: string
  /** Off → the shift drawer is hidden; expenses + day close cover the cash book. */
  cashDrawerEnabled?: boolean
}) {
  const perms = usePermissions()
  const canSee = (title: string) => {
    if (title === "Cash Drawer" && !cashDrawerEnabled) return false
    const p = NAV_PERM[title]
    return !p || perms.has(p)
  }
  const navTop = data.navTop.filter((i) => canSee(i.title))
  const navGroups = data.navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i.title)) }))
    .filter((g) => g.items.length > 0)
  const navSecondary = data.navSecondary.filter((i) => canSee(i.title))
  // Resolved across every nav url at once so only the deepest match lights up
  // ("/reports" must not stay lit on "/reports/day").
  const activeUrl = useActiveUrl([
    ...navTop.map((i) => i.url),
    ...navGroups.flatMap((g) => g.items.map((i) => i.url)),
    ...navSecondary.map((i) => i.url),
  ])
  // Show the switcher whenever there's an active tenant — even with one
  // restaurant it hosts the "+ Add restaurant" action.
  const showSwitcher = (tenants?.length ?? 0) >= 1 && Boolean(activeTenantId)
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        {showSwitcher ? (
          <TenantSwitcher tenants={tenants!} activeId={activeTenantId!} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="data-[slot=sidebar-menu-button]:p-1.5!"
                render={<SidebarNavLink href="/" />}
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
        {/* The CTA is hardcoded inside NavMain rather than being one of
            `navTop`, so its NAV_PERM entry has to be applied by hand. */}
        <NavMain
          items={navTop}
          groups={navGroups}
          showNewOrder={canSee("New Order")}
          activeUrl={activeUrl}
        />
        <NavSecondary items={navSecondary} activeUrl={activeUrl} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user ?? data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
