import { createClient as createBrowserlessClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getActiveTenant } from "@/lib/supabase/tenant"
import { renderJobWith, type TenantCtx } from "@/lib/print/job-render"

/**
 * Hands a claimed print job its bytes.
 *
 * The browser reaches the same code through a server action; this route exists
 * for the headless print agent, which has a bearer token rather than a cookie
 * session. Both go through `renderJobWith`, so a ticket printed by a till and
 * the same ticket printed by the agent are byte-identical.
 *
 * No service role anywhere: the agent signs in as an ordinary staff user and
 * RLS scopes everything it can see.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { jobId?: string; tenantId?: string }
  try {
    body = (await request.json()) as { jobId?: string; tenantId?: string }
  } catch {
    return json({ error: "Expected a JSON body." }, 400)
  }
  if (!body.jobId) return json({ error: "Which job?" }, 400)

  const bearer = request.headers.get("authorization")?.replace(/^Bearer /i, "")
  const resolved = bearer
    ? await fromToken(bearer, body.tenantId)
    : await fromSession()
  if ("error" in resolved) return json({ error: resolved.error }, 401)

  const prepared = await renderJobWith(resolved.supabase, resolved.tenant, body.jobId)
  if ("error" in prepared) return json(prepared, 404)
  return json(prepared, 200)
}

type Resolved =
  | { supabase: Awaited<ReturnType<typeof createClient>>; tenant: TenantCtx }
  | { error: string }

/** A staff member with the app open. */
async function fromSession(): Promise<Resolved> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Sign in first." }

  const tenant = await getActiveTenant()
  if (!tenant) return { error: "No restaurant selected." }
  return { supabase, tenant }
}

/** The print agent, or any other non-browser client. */
async function fromToken(token: string, tenantId?: string): Promise<Resolved> {
  if (!tenantId) return { error: "Which restaurant?" }

  const supabase = createBrowserlessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "That token is not valid." }

  // Membership is checked by reading it back under RLS — a token for another
  // restaurant simply finds nothing here.
  const { data: membership } = await supabase
    .from("user_tenants")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle()
  if (!membership) return { error: "That account is not a member of this restaurant." }

  const [{ data: tenantRow }, { data: settings }] = await Promise.all([
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    supabase
      .from("tenant_settings")
      .select("currency, timezone")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])

  return {
    supabase: supabase as unknown as Awaited<ReturnType<typeof createClient>>,
    tenant: {
      tenantId,
      name: (tenantRow?.name as string) ?? "",
      currency: (settings?.currency as string) ?? "USD",
      timezone: (settings?.timezone as string) ?? "UTC",
    },
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  })
}
