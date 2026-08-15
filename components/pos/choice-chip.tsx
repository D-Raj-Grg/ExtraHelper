"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A chip that is a real radio or checkbox underneath.
 *
 * The input is `sr-only` rather than absent: a div-with-onClick would throw
 * away arrow-key navigation within the group, the checked state a screen reader
 * announces, and form semantics — all things a waiter mid-rush and a keyboard
 * user both rely on. Min height 11 (44px) because this gets hit in a hurry.
 *
 * Grouping is by `name`, exactly like a native radio group.
 */
export function ChoiceChip({
  type = "radio",
  name,
  checked,
  onSelect,
  onCommit,
  disabled = false,
  label,
  detail,
  dot,
  leading,
  showCheck = false,
  className,
}: {
  type?: "radio" | "checkbox"
  name: string
  checked: boolean
  onSelect: () => void
  /**
   * Selection was made deliberately — pointer tap, or Enter on a focused chip.
   * Lets a caller treat picking as the whole answer (advance a step) without
   * breaking arrow-key navigation, which moves the selection but never commits.
   */
  onCommit?: () => void
  disabled?: boolean
  label: React.ReactNode
  detail?: React.ReactNode
  /** A bg-* class for the leading state dot. Never the only signal — `detail` carries the word. */
  dot?: string
  /** Artwork ahead of the text — a glyph or icon. Inherits the chip's text colour. */
  leading?: React.ReactNode
  /** Draw a check on the selected chip, so selection isn't carried by fill colour alone. */
  showCheck?: boolean
  className?: string
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-11 items-center gap-2 rounded-lg border-2 px-3 py-1.5",
        "transition-colors motion-reduce:transition-none",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card",
        !checked && !disabled && "hover:border-ring/50",
        className,
      )}
    >
      <input
        type={type}
        name={name}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        onClick={(e) => {
          // Arrow-keying through a radio group also dispatches click, with
          // detail 0. Only a real pointer tap (detail ≥ 1) commits — otherwise
          // walking the list with the keyboard would fling you to the next step.
          if (e.detail > 0) onCommit?.()
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          if (!checked) onSelect()
          onCommit?.()
        }}
      />
      {leading}
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            // A solid state hue disappears against the selected fill.
            checked ? "bg-primary-foreground" : dot,
          )}
        />
      ) : null}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{label}</span>
        {detail ? (
          <span className={cn("truncate text-xs", checked ? "opacity-80" : "text-muted-foreground")}>
            {detail}
          </span>
        ) : null}
      </span>
      {showCheck && checked ? (
        <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden strokeWidth={3} />
      ) : null}
    </label>
  )
}
