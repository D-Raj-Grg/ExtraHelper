/**
 * Forgiving, ranked dish search. Plain module on purpose — the POS grid, the QR
 * menu and the /menu editor all import it, and a client component may not pull
 * these from a file that touches `lib/supabase/server`.
 *
 * Waiters type with one thumb mid-rush, so the matcher has to forgive what a
 * `name.includes(q)` cannot:
 *   - spacing:   "bigmaster"  finds "Big Master Wine" (and "big master" finds "Bigmaster")
 *   - prefixes:  "chi"        finds "Chicken …", "Chivas …"
 *   - initials:  "bmw"        finds "Big Master Wine"
 *   - typos:     "bigmastar", "cokee", "paner" (one slip; two on long words)
 *   - skipped letters: "chkn" finds "Chicken …"
 *   - options:   "buff"       finds "Tass" through its Buff variant (ranked below name hits)
 *
 * Every query word must match somewhere (AND), then dishes are ranked by how
 * good the best matches were: exact word > word prefix > initials > substring >
 * typo > skipped letters > variant/category hit.
 */

/** Lower-case, strip accents, turn punctuation into spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .trim()
}

export type PreparedQuery = {
  /** Words the user typed, normalised. Empty ⇒ matches everything. */
  tokens: string[]
  /** The same words glued together ("big master" → "bigmaster"). */
  compact: string
}

export function prepareQuery(query: string): PreparedQuery {
  const tokens = normalize(query).split(" ").filter(Boolean)
  return { tokens, compact: tokens.join("") }
}

export type SearchDoc = {
  name: string
  /** Weaker places to look: variant names, the category, a description. */
  extras?: readonly string[]
}

/** Damerau–Levenshtein distance, bailing out past `max` (strings here are tiny). */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  const prev2: number[] = []
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, (prev2[j - 2] ?? Infinity) + 1)
      }
      cur[j] = d
      if (d < rowMin) rowMin = d
    }
    if (rowMin > max) return false
    prev2.length = 0
    prev2.push(...prev)
    prev = cur
  }
  return prev[b.length] <= max
}

function isSubsequence(t: string, word: string): boolean {
  let i = 0
  for (const ch of word) if (ch === t[i]) i++
  return i === t.length
}

type Field = { words: string[]; compact: string; initials: string }

function field(text: string): Field {
  const words = normalize(text).split(" ").filter(Boolean)
  return { words, compact: words.join(""), initials: words.map((w) => w[0]).join("") }
}

/** How well one query word matches one field; 0 = not at all. */
function scoreToken(t: string, f: Field, loose: boolean): number {
  if (f.words.length === 0) return 0
  let best = 0
  for (let i = 0; i < f.words.length; i++) {
    const w = f.words[i]
    // The first word is what staff read first; later words count a touch less.
    const pos = i === 0 ? 4 : 0
    if (w === t) best = Math.max(best, 100 + pos)
    else if (w.startsWith(t)) best = Math.max(best, 80 + pos)
  }
  if (best >= 80) return best
  // Glued: "bigmaster" against "Big Master Wine", or a word typed across a gap.
  if (f.compact.startsWith(t)) return 90
  if (t.length >= 2 && f.initials.startsWith(t)) best = Math.max(best, 70)
  if (t.length >= 3 && f.compact.includes(t)) best = Math.max(best, 55)
  if (best > 0) return best
  // Typos and skipped letters are for the dish's own name; a variant or category
  // is too short and too common a word to forgive freely.
  if (!loose) return 0
  // One slip (two on long words). Compared to each word, and to the same-length
  // head of the glued name so "bigmastar" still lands on "Big Master".
  if (t.length >= 4) {
    const max = t.length >= 8 ? 2 : 1
    for (const w of f.words) {
      if (withinEdits(t, w.slice(0, t.length + 1), max) || withinEdits(t, w, max)) return 45
    }
    if (f.words.length > 1 && withinEdits(t, f.compact.slice(0, t.length), max)) return 45
  }
  // Letters skipped while typing fast: "chkn" → "chicken".
  if (t.length >= 4) {
    for (const w of f.words) {
      if (w[0] === t[0] && isSubsequence(t, w)) return 30
    }
  }
  return 0
}

/**
 * Score a dish against a prepared query. 0 = no match, higher = better.
 * Name hits always outrank hits found only in `extras`.
 */
export function scoreMatch(q: PreparedQuery, doc: SearchDoc): number {
  if (q.tokens.length === 0) return 1
  const name = field(doc.name)
  const extras = (doc.extras ?? []).map(field)

  // The whole query glued together against the glued name: "big master" vs
  // "Bigmaster Wine", "bigmaster" vs "Big Master Wine".
  let whole = 0
  if (q.tokens.length > 1 || q.compact.length > 0) {
    if (name.compact === q.compact) whole = 120
    else if (name.compact.startsWith(q.compact)) whole = 95
  }

  let total = 0
  for (const t of q.tokens) {
    let s = scoreToken(t, name, true)
    if (s === 0) {
      let ex = 0
      for (const f of extras) ex = Math.max(ex, scoreToken(t, f, false))
      s = ex > 0 ? Math.min(ex, 60) * 0.5 : 0
    }
    if (s === 0) return whole // this word matched nowhere; only the glued form may still save it
    total += s
  }
  return Math.max(total / q.tokens.length, whole)
}

/** Dishes that match, best first; ties keep the order they came in. */
export function rankMatches<T>(items: readonly T[], query: string, docOf: (item: T) => SearchDoc): T[] {
  const q = prepareQuery(query)
  if (q.tokens.length === 0) return [...items]
  const scored: { item: T; score: number; i: number }[] = []
  items.forEach((item, i) => {
    const score = scoreMatch(q, docOf(item))
    if (score > 0) scored.push({ item, score, i })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.map((s) => s.item)
}
