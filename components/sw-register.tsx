"use client"

import { useEffect } from "react"

/** Registers the service worker (production only) for installability + shell cache. */
export function SwRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failure is non-fatal */
      })
    }
  }, [])
  return null
}
