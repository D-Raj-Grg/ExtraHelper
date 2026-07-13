-- Wave E: publish menu_items so 86 (out-of-stock) toggles live-propagate to
-- ordering surfaces (POS builder subscribes; KDS can 86 from the line).
alter publication supabase_realtime add table public.menu_items;
