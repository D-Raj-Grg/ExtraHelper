"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"

/**
 * Scannable QR for a table's dine-in link (`/t/{token}`). Encodes the URL as a
 * self-contained PNG data URI (no external CDN — CSP-safe). Print + download.
 */
export function TableQr({ token, label }: { token: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string>("")
  const [url, setUrl] = useState<string>("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const link = `${window.location.origin}/t/${token}`
    setUrl(link)
    QRCode.toDataURL(link, { width: 240, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""))
  }, [token])

  function copy() {
    void navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function print() {
    const w = window.open("", "_blank", "width=400,height=520")
    if (!w) return
    // Build the DOM (no document.write) so `label` is escaped via textContent.
    const doc = w.document
    doc.title = `Table ${label} QR`
    doc.body.style.cssText = "text-align:center;font-family:sans-serif;padding:24px"

    const h2 = doc.createElement("h2")
    h2.textContent = `Table ${label}`
    h2.style.margin = "0 0 4px"

    const sub = doc.createElement("p")
    sub.textContent = "Scan to order"
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
        <img src={dataUrl} alt={`QR for table ${label}`} className="size-40 rounded bg-white p-1" />
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
          render={<a href={dataUrl} download={`table-${label}-qr.png`} />}
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
