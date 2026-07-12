export type CsvColumn = { key: string; label: string }

/** Build a CSV string from rows (RFC-4180 escaping). */
export function toCsv(rows: Record<string, unknown>[], columns?: CsvColumn[]): string {
  if (rows.length === 0) return ""
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.map((c) => esc(c.label)).join(",")
  const body = rows.map((r) => cols.map((c) => esc(r[c.key])).join(",")).join("\n")
  return `${head}\n${body}`
}
