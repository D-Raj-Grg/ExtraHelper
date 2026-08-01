"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderIcon,
  PlugZapIcon,
} from "lucide-react"

import { usePrintAgent } from "@/components/print/print-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const QZ_DOWNLOAD = "https://qz.io/download/"

/** Where QZ Tray looks for the certificate that stops it asking every time. */
const CERT_PATHS = [
  { os: "Windows", match: /win/i, path: "C:\\Program Files\\qz-tray" },
  { os: "macOS", match: /mac/i, path: "/Applications/qz-tray" },
  { os: "Linux", match: /linux|x11/i, path: "/opt/qz-tray" },
] as const

/**
 * Setup for the local print agent.
 *
 * Written as a checklist that watches itself rather than instructions to obey:
 * the agent's WebSocket is polled while this is open, so installing QZ in
 * another window turns step one green here without anyone touching the page.
 * Telling someone to reload is telling them to do the computer's job.
 */
export function PrintSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { status, reconnect } = usePrintAgent()
  const connected = status === "connected"

  // Retry on a timer only while someone is looking at this, and only while it
  // is still down — a background reconnect loop on every page would hammer a
  // socket nobody is waiting on.
  useEffect(() => {
    if (!open || connected) return
    const timer = setInterval(() => reconnect(), 3000)
    return () => clearInterval(timer)
  }, [open, connected, reconnect])

  const platform = usePlatform()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Width is the `size` prop, never a className — DialogContent owns the
          only `max-w-*` on purpose, for the reason written in dialog.tsx. Height
          is already capped there too; the body scrolls inside it. */}
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Direct printing</DialogTitle>
          <DialogDescription>
            QZ Tray is a small program on this computer. It is what sends a ticket straight to
            the printer instead of through a print dialog.
          </DialogDescription>
        </DialogHeader>

        {/* DialogHeader and DialogFooter carry their own p-4; the body is the
            caller's to pad, and to scroll. */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          <StatusStrip status={status} onRetry={reconnect} />

          <ol className="flex flex-col">
            <Step index={1} done={connected} last={false} title="Install QZ Tray">
              <p className="text-sm text-muted-foreground">
                {connected
                  ? "Found and connected on this computer."
                  : "Install it, then leave this window open — it connects on its own."}
              </p>
              <Button
                type="button"
                variant={connected ? "ghost" : "outline"}
                size="sm"
                className="mt-3"
                render={<a href={QZ_DOWNLOAD} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
                {connected ? "Reinstall or update" : "Download QZ Tray"}
              </Button>
            </Step>

            <Step index={2} last title="Add the certificate">
              <p className="text-sm text-muted-foreground">
                Without it, QZ asks for permission every single time something prints. Download it,
                drop it in the QZ Tray folder, and restart QZ.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                render={<a href="/api/qz/cert?download=1" />}
              >
                <DownloadIcon />
                Download override.crt
              </Button>

              <dl className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
                {CERT_PATHS.map((entry) => {
                  const mine = platform !== null && entry.match.test(platform)
                  return (
                    <div key={entry.os} className="contents">
                      <dt
                        className={cn(
                          "py-1",
                          mine ? "font-medium" : "text-muted-foreground",
                        )}
                      >
                        {entry.os}
                        {mine ? <span className="sr-only"> (this computer)</span> : null}
                      </dt>
                      <dd
                        className={cn(
                          "truncate rounded px-2 py-1 font-mono text-xs",
                          mine ? "bg-muted text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {entry.path}
                      </dd>
                      <dd>
                        <CopyButton value={entry.path} label={`${entry.os} folder`} />
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </Step>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Live state, with the retry that replaces "reload this page". */
function StatusStrip({
  status,
  onRetry,
}: {
  status: "connecting" | "connected" | "unavailable"
  onRetry: () => void
}) {
  const tone =
    status === "connected"
      ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : status === "connecting"
        ? "border-border bg-muted text-muted-foreground"
        : "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"

  const Icon =
    status === "connected" ? CheckIcon : status === "connecting" ? LoaderIcon : PlugZapIcon

  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5", tone)}>
      <Icon
        className={cn(
          "size-4 shrink-0",
          status === "connecting" && "animate-spin motion-reduce:animate-none",
        )}
        aria-hidden
      />
      <p className="text-sm font-medium" role="status">
        {status === "connected"
          ? "Connected"
          : status === "connecting"
            ? "Looking for the agent…"
            : "Not detected"}
      </p>
      <p className="text-sm text-muted-foreground">
        {status === "connected"
          ? "Tickets print without a dialog."
          : "Checking every few seconds."}
      </p>
      {status !== "connected" ? (
        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onRetry}>
          Check now
        </Button>
      ) : null}
    </div>
  )
}

/**
 * One step. The rail is a border on the numeral column rather than a pseudo
 * element, so it stops exactly where the last step's content does.
 */
function Step({
  index,
  title,
  done = false,
  last = false,
  children,
}: {
  index: number
  title: string
  done?: boolean
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
            "transition-colors duration-200 ease-out motion-reduce:transition-none",
            done
              ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950"
              : "bg-foreground text-background",
          )}
        >
          {/* Done is carried by the mark, not by the fill — the colour only agrees with it. */}
          {done ? <CheckIcon className="size-4" aria-hidden /> : index}
        </span>
        {!last ? <span className="mt-1 w-px flex-1 bg-border" aria-hidden /> : null}
      </div>

      <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-6")}>
        <h3 className="font-semibold">
          {title}
          {done ? <span className="sr-only"> — done</span> : null}
        </h3>
        {children}
      </div>
    </li>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? `${label} copied` : `Copy the ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? <CheckIcon className="text-emerald-700 dark:text-emerald-400" /> : <CopyIcon />}
    </Button>
  )
}

/**
 * Which OS this is, for highlighting the row that applies. Null when unknown.
 *
 * Read in a lazy initialiser rather than an effect. Safe here specifically
 * because the dialog's contents only mount once `open` is true, and `open` is
 * client state — this subtree is never server-rendered, so there is nothing for
 * it to disagree with.
 */
function usePlatform(): string | null {
  const [platform] = useState<string | null>(() =>
    typeof navigator === "undefined" ? null : navigator.userAgent,
  )
  return platform
}
