/**
 * A top-down diagram of the table: the surface, plus one seat per cover. Seat
 * count is the capacity, so the number under it has a shape to match — and the
 * fill carries the state without leaning on hue: an occupied table's seats are
 * solid, a free table's are hollow. Passes a grayscale screenshot.
 */
export function TableGlyph({
  seats,
  filled,
  className,
}: {
  seats: number
  filled: boolean
  className?: string
}) {
  // Beyond eight the seats stop being countable at this size; the numeric
  // label beside the glyph stays authoritative either way.
  const n = Math.max(1, Math.min(seats || 2, 8))

  // Round-robin the covers onto the four sides so a 4-top reads as one per
  // side and a 6-top puts the extras on the long edges.
  const sides: number[] = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) sides[i % 4] += 1

  const seatRects: { x: number; y: number; w: number; h: number }[] = []
  const [top, bottom, left, right] = sides
  const spread = (count: number, i: number) => 14 + (20 * (i + 1)) / (count + 1)

  for (let i = 0; i < top; i++) seatRects.push({ x: spread(top, i) - 4, y: 5, w: 8, h: 4.5 })
  for (let i = 0; i < bottom; i++)
    seatRects.push({ x: spread(bottom, i) - 4, y: 38.5, w: 8, h: 4.5 })
  for (let i = 0; i < left; i++) seatRects.push({ x: 5, y: spread(left, i) - 4, w: 4.5, h: 8 })
  for (let i = 0; i < right; i++)
    seatRects.push({ x: 38.5, y: spread(right, i) - 4, w: 4.5, h: 8 })

  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden fill="none">
      <rect
        x="13"
        y="13"
        width="22"
        height="22"
        rx="6"
        fill={filled ? "currentColor" : "none"}
        fillOpacity={filled ? 0.14 : undefined}
        stroke="currentColor"
        strokeWidth="2.5"
      />
      {seatRects.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx="2.25"
          fill={filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
        />
      ))}
    </svg>
  )
}
