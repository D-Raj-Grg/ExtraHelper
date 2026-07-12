// Service worker. IMPORTANT: never cache authenticated navigation (HTML)
// responses — on a shared POS tablet that would leak one user's page to the
// next. Navigations are network-only with a STATIC offline fallback. Only
// public static assets are cached. Same-origin GET only; POST/RSC untouched.
const CACHE = "eh-v3"
const OFFLINE_URL = "/offline.html"
const PRECACHE = [OFFLINE_URL, "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Navigations: network-only, fall back to a generic offline page. Never cache
  // per-user HTML.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  // Public static assets: cache-first.
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/icon") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(req).then(
        (m) =>
          m ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
  }
})
