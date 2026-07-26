-- ============================================================================
-- Recipe editor (Phase 1) — the per-dish editor and the coverage view both read
-- recipes by menu_item_id. No schema change is needed for the editor itself
-- (recipes already has unique(menu_item_id, inventory_item_id) for clean
-- upserts); this index just makes those reads cheap.
-- ============================================================================

create index if not exists idx_recipes_menu_item
  on public.recipes (menu_item_id);
