"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"

/** The origin never changes within a document, so there is nothing to subscribe to. */
function subscribeNever() {
  return () => {}
}

/**
 * Scannable QR for an in-app path, with print, download and copy.
 *
 * Encodes the URL as a self-contained PNG data URI — no external CDN, so it
 * survives a strict CSP and works on a till that is offline to everything but
 * the LAN. Shared by the table cards (`/t/{token}`) and the review page
 * (`/r/{slug}`) so there is one way to put a link on paper, not two.
 */
export function LinkQr({
  path,
  heading,
  sub,
  fileName,
  alt,
}: {
  /** Absolute path within this app, e.g. `/r/sekuwa-corner`. */
  path: string
  /** Printed above the code. */
  heading: string
  /** Printed under the heading — the instruction, e.g. "Scan to order". */
  sub: string
  /** Basename for the downloaded PNG, without the extension. */
  fileName: string
  alt: string
}) {
  const [dataUrl, setDataUrl] = useState<string>("")
  const [copied, setCopied] = useState(false)

  // The origin is unknown on the server and constant in the browser, so it is
  // read through a store with an empty server snapshot: hydration matches, and
  // the real value arrives without an effect copying it into state.
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => "",
  )
  const url = origin ? `${origin}${path}` : ""

  useEffect(() => {
    if (!url) return
    // Async, so `setDataUrl` lands in a later tick rather than synchronously
    // during the effect — no cascading render.
    let cancelled = false
    QRCode.toDataURL(url, { width: 240, margin: 1 })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        if (!cancelled) setDataUrl("")
      })
    return () => {
      cancelled = true
    }
  }, [url])

  function copy() {
    void navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function print() {
    const w = window.open("", "_blank", "width=400,height=520")
    if (!w) return
    // Build the DOM (no document.write) so the caller's text is escaped via
    // textContent rather than parsed as HTML.
    const doc = w.document
    doc.title = heading
    doc.body.style.cssText = "text-align:center;font-family:sans-serif;padding:24px"

    const h2 = doc.createElement("h2")
    h2.textContent = heading
    h2.style.margin = "0 0 4px"

    const p = doc.createElement("p")
    p.textContent = sub
    p.style.cssText = "margin:0 0 16px;color:#666"

    const img = doc.createElement("img")
    img.src = dataUrl // data: URI — safe, not HTML
    img.alt = "QR"
    img.style.cssText = "width:280px;height:280px"
    img.onload = () => {
      w.focus()
      w.print()
    }

    doc.body.append(h2, p, img)
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-md border bg-muted/30 p-3">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={alt} className="size-40 rounded bg-white p-1" />
      ) : (
        <div className="size-40 animate-pulse rounded bg-muted" />
      )}
      <p className="max-w-full truncate text-[10px] text-muted-foreground">{url}</p>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={print} disabled={!dataUrl}>
          Print
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!dataUrl}
          render={<a href={dataUrl} download={`${fileName}.png`} />}
          nativeButton={false}
        >
          Download
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  )
}
