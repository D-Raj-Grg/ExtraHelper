"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"

/** The origin never changes within a document, so there is nothing to subscribe to. */
function subscribeNever() {
  return () => {}
}

/**
 * The browser's origin, or "" on the server. Read through a store with an
 * empty server snapshot: hydration matches, and the real value arrives without
 * an effect copying it into state.
 */
export function useOrigin(): string {
  return useSyncExternalStore(subscribeNever, () => window.location.origin, () => "")
}

/**
 * A scannable QR for a URL, as a self-contained PNG data URI (no external CDN —
 * CSP-safe), with Print / Download / Copy link. Table QRs and coupon flyers
 * are both this; only the words around the square differ.
 */
export function QrCard({
  url,
  title,
  subtitle,
  filename,
  alt,
  size = 240,
  children,
}: {
  url: string
  /** Heading on the printed sheet. */
  title: string
  /** One line under the heading on the printed sheet ("Scan to order"). */
  subtitle: string
  /** Download name, without the extension. */
  filename: string
  alt: string
  size?: number
  /** Extra content rendered under the square on screen (a code in large type, a summary line). */
  children?: React.ReactNode
}) {
  const [dataUrl, setDataUrl] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!url) return
    // Async, so `setDataUrl` lands in a later tick rather than synchronously
    // during the effect — no cascading render.
    let cancelled = false
    QRCode.toDataURL(url, { width: size, margin: 1 })
      .then((d) => {
        if (!cancelled) setDataUrl(d)
      })
      .catch(() => {
        if (!cancelled) setDataUrl("")
      })
    return () => {
      cancelled = true
    }
  }, [url, size])

  function copy() {
    void navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function print() {
    const w = window.open("", "_blank", "width=400,height=520")
    if (!w) return
    // Build the DOM (no document.write) so every string is escaped via textContent.
    const doc = w.document
    doc.title = title
    doc.body.style.cssText = "text-align:center;font-family:sans-serif;padding:24px"

    const h2 = doc.createElement("h2")
    h2.textContent = title
    h2.style.margin = "0 0 4px"

    const sub = doc.createElement("p")
    sub.textContent = subtitle
    sub.style.cssText = "margin:0 0 16px;color:#666"

    const img = doc.createElement("img")
    img.src = dataUrl // data: URI — safe, not HTML
    img.alt = "QR"
    img.style.cssText = "width:280px;height:280px"
    img.onload = () => {
      w.focus()
      w.print()
    }

    doc.body.append(h2, sub, img)
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-md border bg-muted/30 p-3">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt={alt} className="size-40 rounded bg-white p-1" />
      ) : (
        <div className="size-40 animate-pulse rounded bg-muted" />
      )}
      {children}
      <p className="max-w-full truncate text-[10px] text-muted-foreground">{url}</p>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={print} disabled={!dataUrl}>
          Print
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!dataUrl}
          render={<a href={dataUrl} download={`${filename}.png`} />}
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
