"use client"

import Link from "next/link"
import { BookOpenIcon, PlusIcon, ReceiptTextIcon, WifiOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Nothing on the board. Which *kind* of nothing matters — each of these needs a
 * different next step from the reader, so they can't share one message.
 */
export function PosEmptyState({
  onNew,
  menuEmpty,
  online,
}: {
  onNew: () => void
  menuEmpty: boolean
  online: boolean
}) {
  // Offline with a cold cache: nothing to do here but reconnect once.
  if (menuEmpty && !online) {
    return (
      <Frame icon={<WifiOffIcon className="size-8 text-muted-foreground" aria-hidden />}>
        <p className="text-base font-semibold">No menu to order from</p>
        <p className="max-w-md text-sm text-muted-foreground">
          You&apos;re offline and this device hasn&apos;t cached the menu yet. Reconnect once and
          it&apos;ll be here next time, even without a signal.
        </p>
      </Frame>
    )
  }

  // Online with no menu: the tenant hasn't built one. Don't blame the network —
  // saying "you're offline" to someone who isn't sends them to debug wifi.
  if (menuEmpty) {
    return (
      <Frame icon={<BookOpenIcon className="size-8 text-muted-foreground" aria-hidden />}>
        <p className="text-base font-semibold">No dishes on the menu yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Add a few dishes and they&apos;ll show up here to tap. You can take an order without them,
          but you&apos;d have to type every line by hand.
        </p>
        {/* nativeButton={false}: this renders an <a>, and Base UI warns unless
            told the element isn't a real <button>. */}
        <Button nativeButton={false} render={<Link href="/menu" />} className="mt-1">
          <BookOpenIcon />
          Build the menu
        </Button>
      </Frame>
    )
  }

  return (
    <Frame icon={<ReceiptTextIcon className="size-8 text-muted-foreground" aria-hidden />}>
      <p className="text-base font-semibold">No orders yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Start one and it&apos;ll show up here. Pick a table or takeaway, tap the dishes, then confirm
        — the kitchen gets its ticket when you fire it.
      </p>
      <Button onClick={onNew} className="mt-1">
        <PlusIcon />
        Add new order
      </Button>
    </Frame>
  )
}

function Frame({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      {icon}
      {children}
    </div>
  )
}
