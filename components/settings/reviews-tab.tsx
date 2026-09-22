"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LinkQr } from "@/components/link-qr"
import { CARD_GRID } from "./types"

/**
 * Guest reviews tab — where the public `/r/{slug}` page is switched on and
 * pointed at this restaurant's own Google listing.
 *
 * Nothing here is platform-wide: per rule #2 every restaurant carries its own
 * listing, its own figures and its own recovery number.
 */
export function ReviewsTab({
  slug,
  reviewEnabled,
  reviewPlaceId,
  reviewListingUrl,
  reviewScore,
  reviewCount,
  reviewChecked,
  reviewContactPhone,
}: {
  /** The tenant's public slug — the `/r/{slug}` the QR encodes. */
  slug: string | null
  reviewEnabled: boolean
  reviewPlaceId: string
  reviewListingUrl: string
  /** Empty string when never checked — "unknown" is a real state, not zero. */
  reviewScore: string
  reviewCount: string
  reviewChecked: string
  reviewContactPhone: string
}) {
  const hasLink = Boolean(reviewPlaceId.trim() || reviewListingUrl.trim())
  const live = reviewEnabled && hasLink && Boolean(slug)

  return (
    <div className={CARD_GRID}>
      <Card>
        <CardHeader>
          <CardTitle>Guest reviews</CardTitle>
          <CardDescription>
            A one-page flow that helps a guest write a Google review and posts them straight to
            your listing. Put the QR on the table or at the till.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reviewEnabled" className="flex items-center gap-2 font-medium">
                <Checkbox
                  id="reviewEnabled"
                  name="reviewEnabled"
                  value="on"
                  defaultChecked={reviewEnabled}
                />
                Publish the review page
              </FieldLabel>
              <FieldDescription>
                Off, or with no listing below, the page returns Not Found — better than sending a
                guest somewhere that goes nowhere.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reviewPlaceId">Google Place ID</FieldLabel>
              <Input
                id="reviewPlaceId"
                name="reviewPlaceId"
                defaultValue={reviewPlaceId}
                placeholder="ChIJR3tEBsdJ6zkR-uCQ7lDT2v0"
              />
              <FieldDescription>
                Lands the guest directly on Google&apos;s star picker. Find yours with Google&apos;s
                Place ID finder.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reviewListingUrl">Listing link</FieldLabel>
              <Input
                id="reviewListingUrl"
                name="reviewListingUrl"
                type="url"
                defaultValue={reviewListingUrl}
                placeholder="https://share.google/…"
              />
              <FieldDescription>
                Used when there is no Place ID, and for the &ldquo;read what other guests
                said&rdquo; link.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="reviewContactPhone">Recovery phone</FieldLabel>
              <Input
                id="reviewContactPhone"
                name="reviewContactPhone"
                type="tel"
                defaultValue={reviewContactPhone}
                placeholder="+977 98…"
              />
              <FieldDescription>
                Offered alongside — never instead of — the Google button when someone picks three
                stars or fewer. Leave it empty to show no phone at all.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>What your listing says</CardTitle>
            <CardDescription>
              Shown on the page as Google reports it, not as your own claim. Leave both empty until
              you have checked — blank shows nothing, where a zero would read as nought out of five.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="reviewScore">Rating</FieldLabel>
                <Input
                  id="reviewScore"
                  name="reviewScore"
                  type="number"
                  min={1}
                  max={5}
                  step="0.1"
                  defaultValue={reviewScore}
                  placeholder="4.8"
                  className="tabular-nums"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reviewCount">Number of reviews</FieldLabel>
                <Input
                  id="reviewCount"
                  name="reviewCount"
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={reviewCount}
                  placeholder="132"
                  className="tabular-nums"
                />
                <FieldDescription>
                  Under ten, the page shows the rating on its own — a small count discourages more
                  than the score persuades.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="reviewChecked">Last checked</FieldLabel>
                <Input
                  id="reviewChecked"
                  name="reviewChecked"
                  type="date"
                  defaultValue={reviewChecked}
                />
                <FieldDescription>
                  A reminder to you, not shown to guests. Refresh the two figures when the listing
                  moves.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Table card</CardTitle>
            <CardDescription>
              Print it, or download the code to drop into a receipt footer or a poster.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {live && slug ? (
              <>
                <Badge variant="secondary">
                  Live at /r/{slug}
                </Badge>
                <LinkQr
                  path={`/r/${slug}`}
                  heading="How did we do?"
                  sub="Scan to leave a review"
                  fileName={`${slug}-review-qr`}
                  alt="QR code for the guest review page"
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {!slug
                  ? "This restaurant has no public slug yet, so there is no address to print."
                  : !hasLink
                    ? "Add a Place ID or a listing link on the left, then save — the QR appears here."
                    : "Tick “Publish the review page” on the left and save to print the QR."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
