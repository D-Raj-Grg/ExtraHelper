-- ============================================================================
-- Veg / non-veg marker on menu items.
--
-- NULLABLE ON PURPOSE — three states, not two:
--   null  = nobody has marked this dish → show nothing
--   true  = vegetarian
--   false = non-vegetarian
--
-- The obvious move is to copy is_86's `not null default false`. That would be
-- wrong here: every existing dish would instantly claim to be non-vegetarian,
-- Dal Bhat and Bara included. Food labelling that is silently wrong is worse
-- than food labelling that is absent, and a tenant who doesn't use the
-- convention should simply never see a mark.
--
-- (menu_items already carries `spice_level` and `allergens jsonb` from the
-- original schema. Both are unread by any code — don't assume they work.)
-- ============================================================================

alter table public.menu_items add column if not exists is_veg boolean;

comment on column public.menu_items.is_veg is
  'null = unmarked (render nothing), true = vegetarian, false = non-vegetarian.';

-- No RLS change: menu_items policies are tenant-scoped and a new column
-- inherits them.
