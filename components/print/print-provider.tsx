"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { PrinterRef } from "@/lib/print/types"

/**
 * Bridge to the local print agent (QZ Tray). The agent listens on a localhost
 * WebSocket and pushes raw ESC/POS straight to the printer — that is what
 * removes the OS print dialog from the middle of a dinner rush.
 *
 * The agent is strictly optional. When it isn't running, `connected` stays
 * false and callers fall back to opening the browser-print page, which is how
 * printing worked before this module. Nothing here may throw into a fire path.
 */

type QzConfig = unknown
type Qz = {
  websocket: {
    connect: (opts?: { retries?: number; delay?: number }) => Promise<void>
    disconnect: () => Promise<void>
    isActive: () => boolean
    setClosedCallbacks: (cb: () => void) => void
  }
  security: {
    setCertificatePromise: (
      fn: (resolve: (v: string) => void, reject: (e: unknown) => void) => void,
    ) => void
    setSignatureAlgorithm: (alg: string) => void
    setSignaturePromise: (
      fn: (
        toSign: string,
      ) => (resolve: (v: string) => void, reject: (e: unknown) => void) => void,
    ) => void
  }
  configs: { create: (printer: unknown, opts?: Record<string, unknown>) => QzConfig }
  print: (config: QzConfig, data: unknown[]) => Promise<void>
}

export type AgentStatus = "connecting" | "connected" | "unavailable"

type PrintCtx = {
  status: AgentStatus
  connected: boolean
  /** Resolves on success; rejects with a printable message on failure. */
  sendRaw: (printer: PrinterRef, dataBase64: string) => Promise<void>
  /** Manual retry from the settings screen. */
  reconnect: () => void
}

const Ctx = createContext<PrintCtx | null>(null)

/** Load the agent library only in the browser, and only once. */
let qzPromise: Promise<Qz> | null = null
function loadQz(): Promise<Qz> {
  qzPromise ??= import("qz-tray").then(
    (m) => ((m as { default?: Qz }).default ?? m) as unknown as Qz,
  )
  return qzPromise
}

export function PrintProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AgentStatus>("connecting")
  const qzRef = useRef<Qz | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function connect() {
      try {
        const qz = await loadQz()
        if (cancelled) return
        qzRef.current = qz

        // Signing is what makes printing silent. The private key never leaves
        // the server — the browser only ever asks it to sign a request.
        qz.security.setCertificatePromise((resolve, reject) => {
          fetch("/api/qz/cert")
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error("no cert"))))
            .then(resolve)
            .catch(reject)
        })
        qz.security.setSignatureAlgorithm("SHA512")
        qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
          fetch("/api/qz/sign", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: toSign,
          })
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error("sign failed"))))
            .then(resolve)
            .catch(reject)
        })

        qz.websocket.setClosedCallbacks(() => {
          if (!cancelled) setStatus("unavailable")
        })

        if (!qz.websocket.isActive()) {
          await qz.websocket.connect({ retries: 2, delay: 1 })
        }
        if (!cancelled) setStatus("connected")
      } catch {
        // No agent installed or not running — expected, not an error state the
        // user needs shouted at them. The fallback covers it.
        if (!cancelled) setStatus("unavailable")
      }
    }

    void connect()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const sendRaw = useCallback(async (printer: PrinterRef, dataBase64: string) => {
    const qz = qzRef.current
    if (!qz || !qz.websocket.isActive()) throw new Error("Print agent not connected")

    // A network printer is addressed by the printer argument itself
    // ({host, port}), not by the options argument — see qz.configs.create.
    const config =
      printer.connection === "network"
        ? qz.configs.create({ host: printer.host ?? "", port: String(printer.port) })
        : qz.configs.create(printer.systemName ?? printer.name)

    await qz.print(config, [{ type: "raw", format: "base64", data: dataBase64 }])
  }, [])

  const reconnect = useCallback(() => {
    // Status is set here rather than in the effect — an effect that setStates
    // on its own first line just triggers a second render for nothing.
    setStatus("connecting")
    setAttempt((n) => n + 1)
  }, [])

  return (
    <Ctx.Provider
      value={{ status, connected: status === "connected", sendRaw, reconnect }}
    >
      {children}
    </Ctx.Provider>
  )
}

/**
 * Agent handle. Returns a disconnected stub outside the provider so a component
 * rendered on a public page (receipt view) degrades to browser printing rather
 * than crashing.
 */
export function usePrintAgent(): PrintCtx {
  return (
    useContext(Ctx) ?? {
      status: "unavailable",
      connected: false,
      sendRaw: async () => {
        throw new Error("Print agent not connected")
      },
      reconnect: () => {},
    }
  )
}
