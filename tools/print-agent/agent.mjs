#!/usr/bin/env node
/**
 * ExtraHelper print agent — cloud printing mode.
 *
 * Runs on any machine in the restaurant that can reach the printers. It takes
 * jobs off the queue and prints them with no browser open anywhere, which is
 * the whole point: a QR or online order arriving at two in the morning has to
 * reach the kitchen even though the till is asleep.
 *
 * It signs in as an ordinary staff user — no service role key, no shared
 * secret. Row-level security scopes everything it can see, exactly as it would
 * for that person sitting at a till.
 *
 * Scope: network printers, over a raw socket to port 9100. USB and system
 * printers still need QZ Tray in a browser, so leave those on Local mode.
 * Image-mode printers are drawn by a browser and are skipped here too — the
 * agent says so on the job rather than printing question marks.
 *
 *   node agent.mjs ./config.json
 */

import net from "node:net"
import fs from "node:fs"
import { createClient } from "@supabase/supabase-js"

const configPath = process.argv[2] ?? new URL("./config.json", import.meta.url).pathname
const config = JSON.parse(fs.readFileSync(configPath, "utf8"))

const required = ["appUrl", "supabaseUrl", "supabaseKey", "email", "password", "tenantId"]
for (const key of required) {
  if (!config[key]) {
    console.error(`config.json is missing "${key}".`)
    process.exit(1)
  }
}

const AGENT_NAME = config.agentName ?? `agent-${process.pid}`
const BRANCH_ID = config.branchId ?? null
const POLL_MS = Number(config.pollMs ?? 5000)
const SOCKET_TIMEOUT_MS = Number(config.socketTimeoutMs ?? 10_000)

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: true },
})

const log = (...args) => console.log(new Date().toISOString(), ...args)

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  })
  if (error) throw new Error(`Sign-in failed: ${error.message}`)
  log(`signed in as ${data.user?.email}`)
}

/**
 * Raw ESC/POS over a socket. Deliberately not a persistent connection: a
 * thermal printer that has been sitting idle for an hour will often accept the
 * bytes and print nothing, and there is no way to tell from this side.
 */
function sendToSocket(host, port, base64) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const done = (err) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (err) reject(err)
      else resolve()
    }

    socket.setTimeout(SOCKET_TIMEOUT_MS)
    socket.on("timeout", () => done(new Error(`${host}:${port} did not respond`)))
    socket.on("error", (err) => done(err))
    socket.connect(port, host, () => {
      socket.write(Buffer.from(base64, "base64"), () => {
        // Give the head a moment to swallow the buffer before the FIN.
        setTimeout(() => done(null), 250)
      })
    })
  })
}

async function render(jobId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Not signed in")

  const res = await fetch(`${config.appUrl.replace(/\/$/, "")}/api/print/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ jobId, tenantId: config.tenantId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? `render failed (${res.status})`)
  return body
}

async function complete(jobId, status, error) {
  const { error: err } = await supabase.rpc("complete_print_job", {
    _job_id: jobId,
    _status: status,
    _error: error ?? null,
  })
  if (err) log(`could not record job ${jobId}: ${err.message}`)
}

let draining = false

async function drain() {
  // One drain at a time, so a realtime burst of station tickets does not start
  // several overlapping claims fighting over the same rows.
  if (draining) return
  draining = true
  try {
    for (let round = 0; round < 5; round++) {
      const { data: jobs, error } = await supabase.rpc("claim_print_jobs", {
        _tenant: config.tenantId,
        _branch: BRANCH_ID,
        _claimer: AGENT_NAME,
        _limit: 5,
        // Say up front what this process can drive rather than claiming a job
        // and failing it. A USB, Bluetooth or image-mode ticket stays on the
        // queue for whatever can actually print it. The checks below stay as
        // well: they are what explains an odd job that slipped through.
        _connections: ["network"],
        _render_modes: ["text"],
      })
      if (error) {
        log(`claim failed: ${error.message}`)
        return
      }
      if (!jobs?.length) return

      for (const job of jobs) {
        try {
          const prepared = await render(job.id)
          const printer = prepared.printer
          if (!printer) {
            await complete(job.id, "failed", "no printer")
            continue
          }
          if (printer.connection !== "network") {
            await complete(
              job.id,
              "failed",
              `${printer.name} is a ${printer.connection} printer — the agent only drives network printers`,
            )
            continue
          }
          if (prepared.payload.kind !== "raw") {
            await complete(
              job.id,
              "failed",
              `${printer.name} is set to image mode, which needs a browser — switch it to text, or use Local mode`,
            )
            continue
          }

          const copies = Math.max(1, Math.min(5, prepared.copies ?? 1))
          for (let i = 0; i < copies; i++) {
            await sendToSocket(printer.host, printer.port, prepared.payload.base64)
          }
          await complete(job.id, "printed")
          log(`printed ${prepared.label} on ${printer.name}`)
        } catch (e) {
          // Out of paper, wrong IP, switched off. The job stays visible and
          // retryable in Settings → Printers rather than vanishing.
          const message = e instanceof Error ? e.message : String(e)
          await complete(job.id, "failed", message)
          log(`job ${job.id} failed: ${message}`)
        }
      }
    }
  } finally {
    draining = false
  }
}

async function main() {
  await signIn()

  supabase
    .channel(`print-jobs:${config.tenantId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "print_jobs",
        filter: `tenant_id=eq.${config.tenantId}`,
      },
      () => void drain(),
    )
    .subscribe((status) => log(`realtime: ${status}`))

  // Realtime is the fast path, not the guarantee: a dropped socket, or a job
  // re-queued after a stale claim, would otherwise sit there forever.
  setInterval(() => void drain(), POLL_MS)
  await drain()
  log(`agent "${AGENT_NAME}" watching for print jobs`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
