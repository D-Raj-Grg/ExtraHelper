/** Initials for an avatar fallback, from a name or email. Client-safe (no deps). */
export function initialsFor(name: string | null | undefined, email?: string | null): string {
  const src = (name ?? "").trim() || (email ?? "").split("@")[0] || ""
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return "U"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
