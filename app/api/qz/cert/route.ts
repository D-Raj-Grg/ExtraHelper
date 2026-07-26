import { createClient } from "@/lib/supabase/server"

/**
 * Public half of the print-agent signing key pair. The agent asks for it before
 * it will accept a signed request; it is safe to hand out, but there is no
 * reason for anyone but a signed-in staff member to have it, so it is gated the
 * same way the signing route is.
 *
 * Returning an empty body when unconfigured is deliberate: the agent treats
 * that as "unsigned", falls back to its own allow-prompt, and printing still
 * works — it just isn't silent yet.
 */
export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("", { status: 401 })

  return new Response(process.env.QZ_PUBLIC_CERT ?? "", {
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  })
}
