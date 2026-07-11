-- Realtime for the floor plan (table states) + POS active-orders list.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='restaurant_tables') then
    alter publication supabase_realtime add table public.restaurant_tables;
  end if;
end $$;

alter table public.restaurant_tables replica identity full;
