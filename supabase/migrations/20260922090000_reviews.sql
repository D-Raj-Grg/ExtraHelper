-- ============================================================================
-- Guest reviews — a public "leave us a review" page, one per restaurant.
--
-- The composer itself is client-side (no guest text ever reaches us; the draft
-- is copied into Google), so all this needs to store is where to send people
-- and what the listing currently says. Per rule #2 nothing here is hardcoded:
-- every restaurant points at its own listing.
--
-- No new table, so no new RLS policy — these are columns on `tenant_settings`,
-- which is already member-scoped. The public page reads them through a
-- SECURITY DEFINER function keyed by slug, the same controlled-anon pattern as
-- `storefront_menu` and the QR flow.
-- ============================================================================

alter table public.tenant_settings
  -- Off by default: an enabled page with no listing link is a dead end, and a
  -- restaurant has to paste its Place ID before the page can do anything.
  add column if not exists review_enabled       boolean not null default false,
  add column if not exists review_place_id      text,
  add column if not exists review_listing_url   text,
  -- Score and count are NULLABLE on purpose. "Not checked yet" is a real state
  -- and it is not zero — a `not null default 0` here would render every new
  -- restaurant as nought out of five.
  add column if not exists review_score         numeric(2,1),
  add column if not exists review_count         integer,
  -- When the two figures above were last read off the listing. They are shown
  -- as reported by Google, not as our own claim.
  add column if not exists review_checked       date,
  -- Where an unhappy guest is offered a direct line instead, on a low rating.
  add column if not exists review_contact_phone text;

alter table public.tenant_settings
  drop constraint if exists tenant_settings_review_score_range;
alter table public.tenant_settings
  add constraint tenant_settings_review_score_range
  check (review_score is null or (review_score >= 1 and review_score <= 5));

alter table public.tenant_settings
  drop constraint if exists tenant_settings_review_count_sane;
alter table public.tenant_settings
  add constraint tenant_settings_review_count_sane
  check (review_count is null or review_count >= 0);

-- ---------------------------------------------------------------------------
-- Public payload for /r/{slug}.
--
-- Returns null — so the route 404s — when the slug is unknown, the restaurant
-- is suspended, or the page has not been switched on. A disabled page must not
-- render an empty composer pointing nowhere.
-- ---------------------------------------------------------------------------
create or replace function public.review_page(_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  _tenant uuid; _name text; _s record;
begin
  select id, name into _tenant, _name
  from public.tenants
  where slug = _slug and status <> 'suspended';
  if _tenant is null then return null; end if;

  select review_enabled, review_place_id, review_listing_url,
         review_score, review_count, review_checked, review_contact_phone
    into _s
  from public.tenant_settings
  where tenant_id = _tenant;

  if not coalesce(_s.review_enabled, false) then return null; end if;

  -- Nothing to link to is the same dead end as being switched off.
  if nullif(trim(coalesce(_s.review_place_id, '')), '') is null
     and nullif(trim(coalesce(_s.review_listing_url, '')), '') is null then
    return null;
  end if;

  return jsonb_build_object(
    'tenant_name',   _name,
    'slug',          _slug,
    'place_id',      nullif(trim(coalesce(_s.review_place_id, '')), ''),
    'listing_url',   nullif(trim(coalesce(_s.review_listing_url, '')), ''),
    'score',         _s.review_score,
    'count',         _s.review_count,
    'checked',       _s.review_checked,
    'contact_phone', nullif(trim(coalesce(_s.review_contact_phone, '')), '')
  );
end $$;

revoke execute on function public.review_page(text) from public, anon, authenticated;
grant  execute on function public.review_page(text) to anon, authenticated;
