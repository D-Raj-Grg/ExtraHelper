"use client"

import { useNewOrder } from "@/components/pos/new-order-provider"
import { NavPending, SidebarNavLink } from "@/components/nav-link"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { PlusIcon } from "lucide-react"

type NavItem = {
  title: string
  url: string
  icon?: React.ReactNode
}

export function NavMain({
  items,
  groups = [],
  showNewOrder = true,
  activeUrl = null,
}: {
  items: NavItem[]
  groups?: { label: string; items: NavItem[] }[]
  /** Holds order.view. Server-side guards and RLS are the real gate. */
  showNewOrder?: boolean
  /** Resolved once across the whole sidebar — see `useActiveUrl`. */
  activeUrl?: string | null
}) {
  const { openNewOrder } = useNewOrder()

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {showNewOrder ? (
            <SidebarMenuItem>
              {/* Opens the composer, not just the board — a button called "New
                  order" that lands you on a list and asks you to press another
                  button is lying about what it does. A dialog rather than a
                  route, so taking an order from the stock count or the cash
                  drawer doesn't cost the page you were on. */}
              <SidebarMenuButton
                tooltip="New order"
                className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                onClick={() => openNewOrder()}
              >
                <PlusIcon />
                <span>New order</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <NavItemLink key={item.title} item={item} activeUrl={activeUrl} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
      {groups.map((group) => (
        <SidebarGroupContent key={group.label} className="mt-2">
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => (
              <NavItemLink key={item.title} item={item} activeUrl={activeUrl} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ))}
    </SidebarGroup>
  )
}

/**
 * One nav row. Split out of the maps above so each row gets its own
 * `useLinkStatus` (inside `NavPending`) for the pending spinner.
 */
function NavItemLink({ item, activeUrl }: { item: NavItem; activeUrl: string | null }) {
  const isActive = item.url === activeUrl
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={isActive}
        aria-current={isActive ? "page" : undefined}
        render={<SidebarNavLink href={item.url} />}
      >
        {item.icon}
        <span>{item.title}</span>
        <NavPending />
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
