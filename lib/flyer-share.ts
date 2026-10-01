/**
 * Hand files to the phone's share sheet (WhatsApp, Messages, AirDrop…).
 * `shared`: the person finished sharing. `cancelled`: they closed the sheet.
 * `unsupported`: this browser can't share files (most desktops), so the caller
 * should fall back to a download.
 */
export async function shareFiles(
  files: File[],
  text: string,
  title: string,
): Promise<"shared" | "cancelled" | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare?.({ files })) {
    return "unsupported"
  }
  try {
    await navigator.share({ files, text, title })
    return "shared"
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "unsupported"
  }
}

/** A wa.me link: opens WhatsApp with the text ready, to `phone` when given (digits, country code first). */
export function whatsappLink(text: string, phone?: string): string {
  const digits = (phone ?? "").replace(/\D/g, "")
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
