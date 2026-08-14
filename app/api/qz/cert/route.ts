/**
 * Public half of the print-agent signing key pair. The agent asks for it before
 * it will accept a signed request.
 *
 * Deliberately NOT gated on a session. This is a public certificate — the same
 * bytes are installed in plain sight as `override.crt` on every operator's
 * machine, so a session check protects nothing. It did cost something, though:
 * when auth hiccuped the route answered 401, the agent library treated the
 * failed fetch as "no certificate" and fell back to sending an *empty* one, and
 * QZ Tray asked the operator to allow every ticket as "an anonymous request" —
 * a silent, confusing downgrade with no error anywhere. The private key stays
 * gated in `/api/qz/sign`; that is the half that matters.
 *
 * Returning an empty body when unconfigured is deliberate: the agent treats
 * that as "unsigned", falls back to its own allow-prompt, and printing still
 * works — it just isn't silent yet.
 */
export async function GET(request: Request): Promise<Response> {
  const cert = process.env.QZ_PUBLIC_CERT ?? ""

  // `?download=1` is the same bytes, named the way QZ Tray expects to find
  // them: dropped into the QZ folder as `override.crt`, it stops the agent
  // asking for permission on every single ticket.
  if (new URL(request.url).searchParams.get("download") === "1") {
    // Unconfigured, the browser would save a 0-byte override.crt, QZ would
    // ignore it, and the prompts would carry on with nobody knowing why. Say so
    // instead — a download that silently produces an empty file is worse than
    // no download.
    if (!cert.trim()) {
      return new Response(
        "Direct printing has no signing certificate yet. Set QZ_PUBLIC_CERT and QZ_PRIVATE_KEY on the server, then download this again.",
        { status: 503, headers: { "content-type": "text/plain", "cache-control": "no-store" } },
      )
    }

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
