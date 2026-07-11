-- ============================================================================
-- Enable Supabase Realtime for the KDS surfaces so the kitchen display updates
-- live (new fires / bumps) instead of polling. RLS still governs what each
-- subscriber receives. REPLICA IDENTITY FULL so tenant_id filters work on
-- updates/deletes too.
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='kots') then
    alter publication supabase_realtime add table public.kots;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='kot_items') then
    alter publication supabase_realtime add table public.kot_items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

alter table public.kots replica identity full;
alter table public.kot_items replica identity full;
alter table public.orders replica identity full;
