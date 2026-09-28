// Set a staff member's password, or create a login for an invite — from a
// client that cannot hold the service-role key (the mobile app).
//
// Mirrors `setMemberPassword` / `createInviteLogin` in
// `app/(app)/team/actions.ts` step for step. The authorisation is the same
// owner-only SQL the web runs (`assert_can_set_member_password`,
// `assert_can_create_invite_login`), executed under the *caller's* JWT so the
// service key only ever performs the one GoTrue write those checks allowed.
//
// POST { tenant_id, password, user_id }  → set password on an existing account
// POST { tenant_id, password, email }    → create the login for a held invite
// 200 { ok: true, email } · 4xx { error }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const url = Deno.env.get("SUPABASE_URL")!
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Same three checks as the web's `passwordProblem`. */
function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters."
  if (password.length > 72) return "Keep it to 72 characters or fewer."
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Mix letters and numbers."
  return null
}

function friendlyPasswordError(message: string): string {
  const msg = message.toLowerCase()
  if (msg.includes("weak") || msg.includes("password")) {
    return "That password was rejected. Use at least 8 characters with a mix of letters and numbers."
  }
  return message
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405)

  const authorization = req.headers.get("Authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401)

  // Everything the caller is allowed to do is decided by SQL under their own
  // token: RLS and the owner-only assert functions, exactly as on the web.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user: actor },
    error: authError,
  } = await asCaller.auth.getUser()
  if (authError || !actor) return json({ error: "Not signed in." }, 401)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: "Bad request." }, 400)
  }
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : ""
  const password = typeof body.password === "string" ? body.password : ""
  const userId = typeof body.user_id === "string" ? body.user_id : ""
  const email = typeof body.email === "string" ? body.email.trim() : ""
  if (!UUID.test(tenantId)) return json({ error: "Bad request." }, 400)
  const problem = passwordProblem(password)
  if (problem) return json({ error: problem }, 400)

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The password itself never goes in the log.
  const audit = (entityId: string, metadata: Record<string, unknown>) =>
    admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actor.id,
      action: "password_reset",
      entity_type: "user_tenant",
      entity_id: entityId,
      metadata,
    })

  if (userId) {
    if (!UUID.test(userId)) return json({ error: "Bad request." }, 400)
    const { data: memberEmail, error: gateError } = await asCaller.rpc(
      "assert_can_set_member_password",
      { _tenant: tenantId, _user_id: userId },
    )
    if (gateError) return json({ error: gateError.message }, 403)

    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json({ error: friendlyPasswordError(error.message) }, 400)

    await audit(userId, { event: "set_password", email: memberEmail })
    return json({ ok: true, email: memberEmail })
  }

  if (email) {
    const { data: invite, error: gateError } = await asCaller.rpc(
      "assert_can_create_invite_login",
      { _tenant: tenantId, _email: email },
    )
    if (gateError || !invite) return json({ error: gateError?.message ?? "Invite not found." }, 403)

    const { data: created, error } = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
    })
    if (error || !created.user) {
      return json({ error: friendlyPasswordError(error?.message ?? "Could not create the login.") }, 400)
    }

    const { error: memberError } = await admin.from("user_tenants").upsert(
      {
        user_id: created.user.id,
        tenant_id: tenantId,
        role: invite.base_role,
        role_id: invite.role_id,
        status: "active",
      },
      { onConflict: "user_id,tenant_id", ignoreDuplicates: true },
    )
    if (memberError) {
      // No membership means an orphan login nobody can use — take it back out.
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: memberError.message }, 400)
    }
    await admin.from("staff_invites").delete().eq("id", invite.id)

    await audit(created.user.id, { event: "create_login", email: invite.email })
    return json({ ok: true, email: invite.email })
  }

  return json({ error: "Bad request." }, 400)
})
