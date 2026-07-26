import { createSign } from "node:crypto"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant } from "@/lib/supabase/tenant"

/**
 * Signs a local print-agent request.
 *
 * This is the security hot spot of the printing module: a signature authorises
 * the agent to act on the operator's machine, and the agent's API reaches past
 * printing into file, serial and USB access. The private key never leaves the
 * server and is never exposed under a NEXT_PUBLIC_ name.
 *
 * What arrives here is NOT the request JSON — the agent library hashes
 * `{call, params, timestamp}` client-side and asks us to sign the resulting
 * SHA-256 hex digest (qz-tray.js: `hash(stringify(signObj))` → `callSign`).
 * So the call name is not inspectable at this point and an allow-list of call
 * names is not possible; the digest shape is checked instead, and the real gate
 * is the session: a signed-in member of an active tenant. Anyone who could
 * reach this endpoint could already drive the POS.
 */

/** SHA-256 hex, lowercase, produced by the agent's own hasher. */
const DIGEST_RE = /^[0-9a-f]{64}$/

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("", { status: 401 })

  // Membership, not just authentication — a signed-in user with no tenant has
  // no business driving a restaurant's hardware.
  const tenant = await getActiveTenant()
  if (!tenant) return new Response("", { status: 403 })

  const toSign = (await request.text()).trim()
  if (!DIGEST_RE.test(toSign)) return new Response("", { status: 400 })

  const key = process.env.QZ_PRIVATE_KEY
  if (!key) {
    // Unconfigured: no signature. The agent asks the operator to allow the
    // request once instead of refusing it, so printing still works — better
    // than a hard failure mid-service.
    return new Response("", { headers: { "content-type": "text/plain" } })
  }

  try {
    const signer = createSign("SHA512")
    signer.update(toSign)
    signer.end()
    const signature = signer.sign(
      process.env.QZ_PRIVATE_KEY_PASSPHRASE
        ? { key, passphrase: process.env.QZ_PRIVATE_KEY_PASSPHRASE }
        : key,
      "base64",
    )
    return new Response(signature, {
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    })
  } catch {
    return new Response("", { status: 500 })
  }
}
