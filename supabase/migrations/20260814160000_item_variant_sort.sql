-- Variant display order.
--
-- Variants came back in whatever order Postgres felt like, so the POS showed
-- "Large, Half, Small" on one fetch and something else on the next. Staff need
-- a stable, owner-chosen order (Small → Large), which is not the same as price
-- order (a Half is cheaper but should still sit last on some menus).
--
-- Backfill by price delta: that is the order the Flutter POS was already
-- imposing client-side, so existing tenants see no visual change on deploy.

alter table public.item_variants
  add column if not exists sort integer not null default 0;

with ordered as (
  select id, row_number() over (
           partition by item_id order by price_delta_cents, name
         ) as rn
  from public.item_variants
)
update public.item_variants v
set sort = ordered.rn
from ordered
where ordered.id = v.id
  and v.sort = 0;

create index if not exists idx_item_variants_item_sort
  on public.item_variants(item_id, sort);
