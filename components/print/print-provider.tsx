"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { rasteriseEscPos } from "./raster"
import type { PrinterRef, PrintPayload } from "@/lib/print/types"

/**
 * Bridge to the local print agent (QZ Tray). The agent listens on a localhost
 * WebSocket and pushes raw ESC/POS straight to the printer — that is what
 * removes the OS print dialog from the middle of a dinner rush.
 *
 * The agent is strictly optional. When it isn't running, `connected` stays
 * false; jobs sit in the queue until a machine with the agent picks them up,
 * or staff opens the browser print view by hand. Nothing here may throw into a
 * fire path.
 */

type QzConfig = unknown
type UsbDevice = { vendorId: string; productId: string; manufacturer?: string; product?: string }

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
  printers: { find: (query?: string) => Promise<string[] | string> }
  usb: {
    listDevices: (includeHubs?: boolean) => Promise<UsbDevice[]>
    listInterfaces: (d: { vendorId: string; productId: string }) => Promise<string[]>
    listEndpoints: (d: {
      vendorId: string
      productId: string
      interface: string
    }) => Promise<string[]>
    claimDevice: (d: {
      vendorId: string
      productId: string
      interface: string
    }) => Promise<void>
    releaseDevice: (d: { vendorId: string; productId: string }) => Promise<void>
    sendData: (d: {
      vendorId: string
      productId: string
      endpoint: string
      data: { data: string; type: string }
    }) => Promise<void>
  }
  configs: { create: (printer: unknown, opts?: Record<string, unknown>) => QzConfig }
  print: (config: QzConfig, data: unknown[]) => Promise<void>
}

export type AgentStatus = "connecting" | "connected" | "unavailable"

/** What the agent discovered about a USB device, worth caching server-side. */
export type UsbPath = { iface: string; endpoint: string }

type PrintCtx = {
  status: AgentStatus
  connected: boolean
  /** System printers QZ can see. Empty until asked. */
  systemPrinters: string[]
  /**
   * Sends one document. Resolves with a USB path when it had to discover one,
   * so the caller can cache it. Rejects with a printable message on failure.
   */
  send: (
    printer: PrinterRef,
    payload: PrintPayload,
    copies?: number,
  ) => Promise<UsbPath | null>
  listSystemPrinters: () => Promise<string[]>
  listUsbDevices: () => Promise<UsbDevice[]>
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
  const [systemPrinters, setSystemPrinters] = useState<string[]>([])
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
        if (cancelled) return
        setStatus("connected")

        // Populated eagerly so the setup sheet's picker isn't empty on open.
        try {
          const found = await qz.printers.find()
          if (!cancelled) setSystemPrinters(Array.isArray(found) ? found : [found])
        } catch {
          // Listing needs its own permission grant in QZ; not being allowed to
          // list is not a reason to say printing is down.
        }
      } catch {
        // No agent installed or not running — expected, not an error state the
        // user needs shouted at them.
        if (!cancelled) setStatus("unavailable")
      }
    }

    void connect()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const send = useCallback(
    async (
      printer: PrinterRef,
      payload: PrintPayload,
      copies = 1,
    ): Promise<UsbPath | null> => {
      const qz = qzRef.current
      if (!qz || !qz.websocket.isActive()) throw new Error("Print agent not connected")

      // Both modes end up as one base64 blob of ESC/POS: text mode was built
      // on the server, image mode is drawn and encoded here.
      const base64 =
        payload.kind === "raw"
          ? payload.base64
          : rasteriseEscPos(payload.doc, {
              paperWidthMm: payload.paperWidthMm,
              autoCut: printer.autoCut,
              openDrawer: printer.openDrawer,
            })

      const runs = Math.max(1, Math.min(5, copies))

      if (printer.connection === "usb") {
        return sendUsb(qz, printer, base64, runs)
      }

      // Unreachable in practice — `claimPrintJobs` never hands a browser a
      // Bluetooth job. Kept so that if it ever does, it says why instead of
      // quietly asking QZ for a system printer of that name and printing
      // nothing.
      if (printer.connection === "bluetooth") {
        throw new Error(
          `${printer.name} is a Bluetooth printer. Print it from the ExtraHelper app on a paired Android phone — a browser cannot open a Bluetooth connection.`,
        )
      }

      const data = [{ type: "raw", format: "base64", data: base64 }]

      // A network printer is addressed by the printer argument itself
      // ({host, port}), not by the options argument — see qz.configs.create.
      const config =
        printer.connection === "network"
          ? qz.configs.create({ host: printer.host ?? "", port: String(printer.port) })
          : qz.configs.create(printer.systemName ?? printer.name)

      for (let i = 0; i < runs; i++) await qz.print(config, data)
      return null
    },
    [],
  )

  const listSystemPrinters = useCallback(async () => {
    const qz = qzRef.current
    if (!qz || !qz.websocket.isActive()) throw new Error("Print agent not connected")
    const found = await qz.printers.find()
    const list = Array.isArray(found) ? found : [found]
    setSystemPrinters(list)
    return list
  }, [])

  const listUsbDevices = useCallback(async () => {
    const qz = qzRef.current
    if (!qz || !qz.websocket.isActive()) throw new Error("Print agent not connected")
    try {
      return await qz.usb.listDevices(false)
    } catch (e) {
      // A scan that fails here fails for the whole USB route, not this device —
      // say which, or the operator retries the scan forever.
      throw usbError(e)
    }
  }, [])

  return (
    <Ctx.Provider
      value={{
        status,
        connected: status === "connected",
        systemPrinters,
        send,
        listSystemPrinters,
        listUsbDevices,
        reconnect: () => {
          // Status is set here rather than in the effect — an effect that
          // setStates on its own first line renders twice for nothing.
          setStatus("connecting")
          setAttempt((n) => n + 1)
        },
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

/**
 * QZ's raw USB API is a JNI binding over libusb, and the native half is simply
 * absent from some builds — notably QZ Tray on Apple Silicon, where every
 * `usb.*` call dies with `UnsatisfiedLinkError: org.usb4java.LibUsb.init` and
 * QZ answers the browser with this one sentence. It reads like an outage on our
 * side, so it gets translated into the thing that actually fixes it: the same
 * printer, addressed through the OS queue instead of raw USB.
 */
const USB_NATIVE_MISSING = /unavailable at this time|missing or broken/i

function usbError(e: unknown, printerName?: string): Error {
  const message = e instanceof Error ? e.message : String(e)
  if (!USB_NATIVE_MISSING.test(message)) {
    return e instanceof Error ? e : new Error(message)
  }
  const subject = printerName ?? "the printer"
  return new Error(
    `QZ Tray on this computer cannot talk to USB devices directly — its USB component is missing, which is normal on Apple Silicon Macs. Add ${subject} as a printer in system settings, then set this printer's Connection to "System printer".`,
  )
}

/**
 * USB is claim → write → release, not a config. The interface and the OUT
 * endpoint are discovered once and handed back so they can be cached: the scan
 * costs two extra round trips to the device, and a busy pass fires a lot of
 * tickets.
 */
async function sendUsb(
  qz: Qz,
  printer: PrinterRef,
  base64: string,
  runs: number,
): Promise<UsbPath | null> {
  const vendorId = printer.usbVendorId ?? ""
  const productId = printer.usbProductId ?? ""
  if (!vendorId || !productId) throw new Error("This printer has no USB address.")

  try {
    let iface = printer.usbInterface
    let endpoint = printer.usbEndpoint
    let discovered = false

    if (!iface || !endpoint) {
      const interfaces = await qz.usb.listInterfaces({ vendorId, productId })
      iface = interfaces[0]
      if (!iface) throw new Error("That USB device has no printable interface.")
      const endpoints = await qz.usb.listEndpoints({ vendorId, productId, interface: iface })
      // Bit 7 set means an IN endpoint — that one reads, it does not print.
      endpoint = endpoints.find((e) => (Number.parseInt(e, 16) & 0x80) === 0) ?? endpoints[0]
      if (!endpoint) throw new Error("That USB device has no endpoint to write to.")
      discovered = true
    }

    await qz.usb.claimDevice({ vendorId, productId, interface: iface })
    try {
      for (let i = 0; i < runs; i++) {
        await qz.usb.sendData({
          vendorId,
          productId,
          endpoint,
          data: { data: base64, type: "BASE64" },
        })
      }
    } finally {
      // Left claimed, the device is unusable by anything else until QZ restarts.
      await qz.usb.releaseDevice({ vendorId, productId }).catch(() => {})
    }

    return discovered ? { iface, endpoint } : null
  } catch (e) {
    throw usbError(e, printer.name)
  }
}

/**
 * Agent handle. Returns a disconnected stub outside the provider so a component
 * rendered on a public page (receipt view) degrades gracefully rather than
 * crashing.
 */
export function usePrintAgent(): PrintCtx {
  return (
    useContext(Ctx) ?? {
      status: "unavailable",
      connected: false,
      systemPrinters: [],
      send: async () => {
        throw new Error("Print agent not connected")
      },
      listSystemPrinters: async () => [],
      listUsbDevices: async () => [],
      reconnect: () => {},
    }
  )
}
