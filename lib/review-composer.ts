/**
 * The guest review composer's phrase bank.
 *
 * A guest picks a star rating and taps what stood out; this assembles a draft
 * they can paste into Google. Every part is drawn from a pool and the sentences
 * are shuffled, so two guests who tap the same chips still walk away with
 * visibly different text — a fixed template posted verbatim by dozens of
 * accounts is exactly what Google's duplicate filter removes.
 *
 * The draft is a starting point, not a script: the page tells the guest to put
 * it in their own words before posting.
 *
 * A plain module on purpose — no `"use client"`, no `lib/supabase/server`. The
 * public page (a Server Component) and the composer (a client component) both
 * import it, and either boundary crossed the wrong way breaks the build or,
 * worse, 500s at render.
 */

export type Tone = "praise" | "improve"

export type Aspect = {
  id: string
  /** Chip label at 4–5 stars. */
  label: string
  /** Chip label at 1–3 stars, where the question is what to fix. */
  improveLabel: string
  praise: string[]
  improve: string[]
}

/** Ratings at or below this switch the composer into "what could be better". */
export const CRITICAL_MAX = 3

/**
 * Below this many reviews the raw count discourages more than the score
 * persuades, so only the score is shown. Never inflate it — it sits next to a
 * link that opens the real listing.
 */
export const MIN_COUNT_TO_SHOW = 10

/**
 * Deliberately generic across cuisines and countries: this ships to every
 * restaurant on the platform, so nothing here names a dish, a currency or a
 * region. The restaurant's own name is the only thing interpolated.
 */
export const aspects: Aspect[] = [
  {
    id: "food",
    label: "The food",
    improveLabel: "Food",
    praise: [
      "The food came out properly cooked and full of flavour.",
      "Everything we ordered was fresh and tasted like someone cared about it.",
      "Really good food. We finished every plate.",
    ],
    improve: [
      "The food was alright but it could have had more flavour.",
      "A couple of dishes came out cold, which let the rest of the meal down.",
    ],
  },
  {
    id: "service",
    label: "Service",
    improveLabel: "Service",
    praise: [
      "The staff were friendly and checked on us without hovering.",
      "Service was attentive from the moment we sat down.",
      "The team here are polite and they know the menu properly.",
    ],
    improve: [
      "Service was a bit slow to get going. A little more attention at the table would help.",
      "We had to ask twice for a few things. The staff were friendly about it though.",
    ],
  },
  {
    id: "speed",
    label: "Quick service",
    improveLabel: "Waiting time",
    praise: [
      "Food arrived quickly even though it was busy.",
      "We were in and out without waiting around, which suited us.",
      "Orders came out fast and in the right order.",
    ],
    improve: [
      "The wait between ordering and eating was longer than expected.",
      "Food took a while to arrive at peak time. Worth knowing before you go.",
    ],
  },
  {
    id: "value",
    label: "Value for money",
    improveLabel: "Pricing",
    praise: [
      "Prices are fair for the quality and the amount you get.",
      "Good value. We ate well without spending much.",
      "For what you pay, this is hard to beat.",
    ],
    improve: [
      "Slightly pricey for the portion sizes.",
      "The bill came to more than we expected for what we had.",
    ],
  },
  {
    id: "portions",
    label: "Portions",
    improveLabel: "Portions",
    praise: [
      "Portions are generous. Nobody left hungry.",
      "The servings are a proper size, not the tiny plates you get elsewhere.",
      "Plenty of food for the money.",
    ],
    improve: [
      "Portions were smaller than we expected.",
      "A slightly bigger serving would make the price feel right.",
    ],
  },
  {
    id: "cleanliness",
    label: "Cleanliness",
    improveLabel: "Cleanliness",
    praise: [
      "The place is clean — tables, floors, washroom, all of it.",
      "Spotless inside, which honestly is not that common.",
      "Tables were wiped down properly before we sat.",
    ],
    improve: [
      "The washroom could do with more frequent checks.",
      "Tables took a while to get cleared when it got busy.",
    ],
  },
  {
    id: "ambience",
    label: "Atmosphere",
    improveLabel: "Atmosphere",
    praise: [
      "Comfortable place to sit and eat. Good lighting, not too loud.",
      "Nice atmosphere. We stayed longer than we planned to.",
      "Relaxed setting, easy to have a conversation.",
    ],
    improve: [
      "It gets very loud when it fills up, so it is hard to talk.",
      "The seating could be more comfortable for a longer meal.",
    ],
  },
  {
    id: "drinks",
    label: "Drinks",
    improveLabel: "Drinks",
    praise: [
      "Good selection of drinks and they arrived cold.",
      "The drinks are well made, not an afterthought.",
      "Plenty of choice at the bar.",
    ],
    improve: [
      "The drinks list could do with a few more options.",
      "Drinks took longer to arrive than the food did.",
    ],
  },
  {
    id: "takeaway",
    label: "Takeaway & delivery",
    improveLabel: "Takeaway & delivery",
    praise: [
      "Ordered for takeaway and everything arrived hot and packed properly.",
      "Delivery turned up on time with nothing missing from the order.",
      "The packaging holds up, so the food is still worth eating when it gets home.",
    ],
    improve: [
      "The takeaway order took longer than the time we were quoted.",
      "Better packaging would keep the food warmer on the way home.",
    ],
  },
]

/**
 * `{name}` is replaced with the restaurant's own name, so the draft reads like
 * a review of somewhere specific rather than a form letter.
 */
const openers: Record<Tone, string[]> = {
  praise: [
    "Ate at {name} recently and it was genuinely good.",
    "{name} has become our regular spot and it earns it.",
    "Really enjoyed our meal at {name}.",
    "Came to {name} on a recommendation and we were not disappointed.",
    "Good experience at {name}.",
  ],
  improve: [
    "Ate at {name} recently. A lot of it was good but a few things need work.",
    "Decent meal at {name}, though there is room to improve.",
    "Mixed feelings about {name}.",
    "{name} has potential but a couple of things let it down.",
  ],
}

const closers: Record<Tone, string[]> = {
  praise: [
    "Would recommend it and we will be back.",
    "Worth a visit if you are in the area.",
    "Happy to recommend this place.",
    "We will definitely be coming back.",
    "Five stars from us.",
  ],
  improve: [
    "Hoping these get sorted, because the basics are already there.",
    "Would happily raise my rating if things improve.",
    "Still worth a try, but there is work to do.",
    "Sharing this as honest feedback, not a complaint.",
  ],
}

/** Small deterministic PRNG, so a re-roll gives a different but repeatable draft. */
function mulberry32(seed: number) {
  // Scramble first: raw nearby seeds otherwise produce correlated first draws,
  // which would make a re-roll look like the same review again.
  let a = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function toneFor(rating: number): Tone {
  return rating > CRITICAL_MAX ? "praise" : "improve"
}

/**
 * Assemble a draft from the chosen rating, aspects and restaurant name.
 *
 * `seed` changes the wording without changing the selection — that is what
 * "try another wording" passes.
 */
export function composeReview(
  rating: number,
  selected: string[],
  seed: number,
  restaurantName: string,
): string {
  if (!rating) return ""

  const rng = mulberry32(seed + rating * 7919)
  const tone = toneFor(rating)

  const chosen = aspects.filter((a) => selected.includes(a.id))
  const lines = shuffle(chosen, rng).map((a) => pick(a[tone], rng))

  // Name substitution happens after the pick so the pools stay plain strings.
  const opener = pick(openers[tone], rng).replaceAll("{name}", restaurantName)

  return [opener, ...lines, pick(closers[tone], rng)].join(" ").trim()
}

/**
 * Deep link that opens Google's "write a review" dialog.
 *
 * With a Place ID the guest lands straight on the star picker; without one it
 * falls back to whatever listing URL the restaurant saved, where reviews are
 * still one tap away. Returns "" when neither is set — but `review_page`
 * already refuses to serve that case, so the page never renders it.
 */
export function writeReviewHref(placeId: string | null, listingUrl: string | null): string {
  if (placeId) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
  return listingUrl ?? ""
}

/** The listing's own review list — for reading them, not writing one. */
export function readReviewsHref(placeId: string | null, listingUrl: string | null): string {
  if (placeId) return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`
  return listingUrl ?? ""
}
