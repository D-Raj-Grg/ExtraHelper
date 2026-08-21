#!/usr/bin/env node
/**
 * Fails when a Server Component imports a non-component VALUE from a
 * "use client" module.
 *
 * Why this needs its own check: every export of a client module becomes a
 * *client reference* when a Server Component imports it. Components are fine —
 * that is the whole point of the boundary — but calling a plain function throws
 * at render:
 *
 *   Attempted to call a temporary Client Reference from the server but it is on
 *   the client. It's not possible to invoke a client function from the server.
 *
 * Both `tsc --noEmit` and `next build` pass, because nothing is type-wrong and
 * nothing fails to compile. The page 500s the first time somebody opens it.
 * That is exactly how the day-close Orders list shipped broken: the pure helpers
 * (lineTotal, lineCount, destination) were exported from the client table and
 * called by the server list. Fix is always the same — move the shared values
 * into a plain module both sides import.
 *
 * This is CLAUDE.md's "a client component may not import from a file that
 * imports lib/supabase/server" rule, crossed in the other direction.
 *
 * Heuristic: an imported binding starting with a lowercase letter is a value;
 * PascalCase is assumed to be a component and allowed. `import type` is erased
 * and always fine.
 *
 * Run: npm run check:rsc
 */
import { readFileSync } from "node:fs"
import { globSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const files = globSync("**/*.{ts,tsx}", {
  cwd: ROOT,
  exclude: (p) => p.includes("node_modules") || p.includes(".next"),
}).map((f) => f.replaceAll(path.sep, "/"))

const src = new Map()
for (const f of files) {
  try {
    src.set(f, readFileSync(path.join(ROOT, f), "utf8"))
  } catch {
    /* directories the glob hands back — ignore */
  }
}

const isClient = new Map(
  [...src].map(([f, t]) => [f, /^\s*["']use client["']/.test(t)]),
)

function resolve(importer, spec) {
  let base
  if (spec.startsWith("@/")) base = spec.slice(2)
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec))
  else return null
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (src.has(cand)) return cand
  }
  return null
}

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
const findings = []

for (const [file, text] of src) {
  if (isClient.get(file)) continue // client importing client is fine
  for (const [, typeOnly, names, spec] of text.matchAll(IMPORT)) {
    if (typeOnly) continue
    const target = resolve(file, spec)
    if (!target || !isClient.get(target)) continue
    for (const raw of names.split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (!name || name.startsWith("type ")) continue
      if (name[0] === name[0].toLowerCase()) {
        findings.push(`${file}\n    imports value \`${name}\` from client module ${target}`)
      }
    }
  }
}

if (findings.length) {
  console.error("Server Component imports a value from a \"use client\" module:\n")
  for (const f of findings) console.error("  " + f)
  console.error(
    "\nThese throw at render, not at build. Move the shared value into a plain" +
      "\nmodule (no \"use client\") that both sides import.\n",
  )
  process.exit(1)
}

console.log(`check:rsc — clean across ${src.size} files`)
