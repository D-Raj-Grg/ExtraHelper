"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/25 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

/**
 * Width of the dialog on a tablet/desktop viewport.
 *
 * Like SheetContent, this is a **prop, not a className** — and the base class
 * below deliberately carries no `max-w-*` of its own so this map is the only
 * source of one. Sheet learned that the hard way: it had a variant-prefixed
 * width in its base class, a caller's plain `sm:max-w-lg` looked like a
 * different utility to tailwind-merge, both survived, and the base one won on
 * specificity — silently pinning every sheet in the app to `max-w-sm`. Keeping
 * width in one place is what stops that repeating here.
 */
const DIALOG_SIZE: Record<string, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
}

/**
 * Phone layout, shared by every size: the whole viewport. Staff use this
 * tableside one-handed, and "never amputate features on small screens" cuts
 * both ways — a centred card would waste the room the cart rail needs.
 *
 * 100dvh, not 100vh: with vh the iOS URL bar overlaps the bottom of the popup
 * and swallows the confirm button.
 */
const DIALOG_BASE =
  "fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg outline-none"

/**
 * Tablet/desktop layouts. These are mutually exclusive branches, not a default
 * plus an override — `full` is inset-anchored and `centred` is translate-
 * anchored, and trying to build one on top of the other means undoing half of
 * it (`left-auto` vs `inset-4`), which collapses the box to its content width.
 * Two branches, no fight.
 */
const DIALOG_CENTRED =
  "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border"
const DIALOG_FULL = "sm:inset-4 sm:h-auto sm:w-auto sm:max-w-none sm:rounded-lg sm:border"

function DialogContent({
  className,
  children,
  size = "md",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  size?: "sm" | "md" | "lg" | "xl" | "full"
  showCloseButton?: boolean
}) {
  const isFull = size === "full"
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          DIALOG_BASE,
          isFull ? DIALOG_FULL : cn(DIALOG_CENTRED, DIALOG_SIZE[size]),
          // Transform + opacity only, ease-out, no bounce.
          "transition-[opacity,transform,scale] duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 sm:data-ending-style:scale-[0.98] sm:data-starting-style:scale-[0.98] motion-reduce:transition-none",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" size="icon" className="absolute top-3 right-3 z-10" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-0.5 border-b p-4", className)}
      {...props}
    />
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

/**
 * Required on every DialogContent — base-ui labels the popup from it. When the
 * design has no visible title, keep it and add `className="sr-only"`; don't
 * drop it, or the dialog is anonymous to a screen reader.
 */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
