"use client"

import { useMemo, useRef, useState } from "react"
import { CheckIcon, CopyIcon, ExternalLinkIcon, PhoneIcon, RefreshCwIcon, StarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChoiceChip } from "@/components/pos/choice-chip"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  aspects,
  composeReview,
  CRITICAL_MAX,
  readReviewsHref,
  writeReviewHref,
} from "@/lib/review-composer"
import { cn } from "@/lib/utils"

const RATINGS = [1, 2, 3, 4, 5]

const randomSeed = () => Math.floor(Math.random() * 0x7fffffff)

/**
 * Guest-facing "leave us a review" flow: rating → what stood out → a draft they
 * can edit → post it on Google.
 *
 * Nothing is submitted to us. The draft lives in this component and leaves via
 * the clipboard, which is the whole point — the review has to be posted by the
 * guest from their own account or Google discards it.
 */
export function ReviewComposer({
  restaurantName,
  placeId,
  listingUrl,
  contactPhone,
}: {
  restaurantName: string
  placeId: string | null
  listingUrl: string | null
  /** Offered instead of a public post when the rating is low. Null = no phone saved. */
  contactPhone: string | null
}) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  // Seeded on the first star tap, so two guests who pick the same rating and
  // chips do not walk away with byte-identical text. Only ever set from an
  // event handler, so the server and first client render still agree.
  const [seed, setSeed] = useState(1)
  /** The guest's own edits, which win until they change an input above. */
  const [edited, setEdited] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  const isCritical = rating > 0 && rating <= CRITICAL_MAX

  const generated = useMemo(
    () => composeReview(rating, selected, seed, restaurantName),
    [rating, selected, seed, restaurantName],
  )
  const draft = edited ?? generated

  const wordCount = useMemo(() => draft.trim().split(/\s+/).filter(Boolean).length, [draft])

  const writeHref = writeReviewHref(placeId, listingUrl)
  const readHref = readReviewsHref(placeId, listingUrl)

  /** Any change to the inputs re-drafts, discarding a stale hand-edit. */
  function regenerate() {
    setEdited(null)
    setCopied(false)
  }

  function choose(value: number) {
    setRating(value)
    setSeed(randomSeed())
    regenerate()
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    regenerate()
  }

  function reroll() {
    setSeed(randomSeed())
    regenerate()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      // Clipboard blocked (insecure origin, or permission refused) — select the
      // text so the guest can still copy it by hand rather than hitting a
      // button that silently does nothing.
      field.current?.select()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1 — Rating */}
      <Card>
        <CardHeader>
          <CardTitle>1. How was it?</CardTitle>
          <CardDescription>Tap a rating. Everything below follows from it.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-wrap items-center gap-2"
            onMouseLeave={() => setHovered(0)}
            role="radiogroup"
            aria-label="Your rating out of five"
          >
            {RATINGS.map((value) => {
              const lit = value <= (hovered || rating)
              return (
                // A real radio underneath: arrow keys move through the group and
                // a screen reader announces the checked one. A div with onClick
                // would throw both away.
                <label
                  key={value}
                  onMouseEnter={() => setHovered(value)}
                  className={cn(
                    // 44px minimum — this is tapped on a phone at a table.
                    "flex size-11 cursor-pointer items-center justify-center rounded-lg border-2",
                    "transition-colors motion-reduce:transition-none",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    lit ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                  )}
                >
                  <input
                    type="radio"
                    name="rating"
                    className="sr-only"
                    checked={rating === value}
                    onChange={() => choose(value)}
                    onFocus={() => setHovered(value)}
                    onBlur={() => setHovered(0)}
                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                  />
                  <StarIcon className={cn("size-5", lit && "fill-current")} aria-hidden />
                </label>
              )
            })}
            {/* The number, not just the fill: a filled-vs-outline star is a
                shape difference, but the count spells it out regardless. */}
            {rating > 0 ? (
              <span className="ml-2 text-sm font-semibold tabular-nums">{rating} / 5</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* 2 — Aspects */}
      <Card className={cn(!rating && "opacity-60")}>
        <CardHeader>
          <CardTitle>
            {isCritical ? "2. What could we do better?" : "2. What stood out?"}
          </CardTitle>
          <CardDescription>Tap as many as you like, or skip straight to the draft.</CardDescription>
        </CardHeader>
        <CardContent>
          {rating === 0 ? (
            <p className="text-sm text-muted-foreground">Pick a rating above to start.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {aspects.map((aspect) => (
                <ChoiceChip
                  key={aspect.id}
                  type="checkbox"
                  name="aspect"
                  checked={selected.includes(aspect.id)}
                  onSelect={() => toggle(aspect.id)}
                  showCheck
                  label={isCritical ? aspect.improveLabel : aspect.label}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3 — Draft */}
      <Card className={cn(!rating && "opacity-60")}>
        <CardHeader>
          <CardTitle>3. Your review</CardTitle>
          <CardDescription>
            A starting point only — change it so it sounds like you. Reviews in someone&apos;s own
            words help people more, and Google is likelier to keep them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rating === 0 ? (
            <p className="text-sm text-muted-foreground">Your review will appear here.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="review-draft" className="sr-only">
                  Your review draft
                </FieldLabel>
                <Textarea
                  id="review-draft"
                  ref={field}
                  value={draft}
                  onChange={(e) => {
                    setEdited(e.target.value)
                    setCopied(false)
                  }}
                  rows={5}
                  className="min-h-32 leading-relaxed"
                  placeholder="Tap a few things above, or just write your own…"
                />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={copy} disabled={!draft.trim()} className="h-11 px-4">
                  {copied ? (
                    <>
                      <CheckIcon aria-hidden /> Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon aria-hidden /> Copy review
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={reroll}
                  disabled={!draft.trim()}
                  className="h-11 px-4"
                >
                  <RefreshCwIcon aria-hidden /> Try another wording
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {wordCount} {wordCount === 1 ? "word" : "words"}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4 — Post */}
      <Card className={cn(!rating && "opacity-60")}>
        <CardHeader>
          <CardTitle>4. Post it on Google</CardTitle>
          <CardDescription>Opens in a new tab. Paste your review, set the stars, post.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            variant={rating ? "default" : "outline"}
            className="h-11 w-full px-4 sm:w-auto"
            nativeButton={false}
            render={<a href={writeHref} target="_blank" rel="noopener noreferrer" />}
          >
            Open Google review <ExternalLinkIcon aria-hidden />
          </Button>

          {isCritical ? (
            // Service recovery, not review-gating: the Google button above stays
            // exactly as available as it is on a five-star rating. This only adds
            // a direct line for someone who would rather be put right than post.
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm leading-relaxed">
                Sorry it wasn&apos;t what you hoped for. Post the review if you want to — honest
                feedback helps us.
                {contactPhone
                  ? " If you would rather we put it right directly, give us a call."
                  : ""}
              </p>
              {contactPhone ? (
                <Button
                  variant="outline"
                  className="mt-3 h-11 px-4"
                  nativeButton={false}
                  render={<a href={`tel:${contactPhone}`} />}
                >
                  <PhoneIcon aria-hidden /> Call {contactPhone}
                </Button>
              ) : null}
            </div>
          ) : null}

          {readHref ? (
            <a
              href={readHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Read what other guests said
            </a>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
