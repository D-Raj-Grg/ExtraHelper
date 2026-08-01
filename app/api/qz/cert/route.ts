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
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("", { status: 401 })

  const cert = process.env.QZ_PUBLIC_CERT ?? ""

  // `?download=1` is the same bytes, named the way QZ Tray expects to find
  // them: dropped into the QZ folder as `override.crt`, it stops the agent
  // asking for permission on every single ticket.
  if (new URL(request.url).searchParams.get("download") === "1") {
    return new Response(cert, {
      headers: {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="override.crt"',
        "cache-control": "no-store",
      },
    })
  }

  return new Response(cert, {
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  })
}
