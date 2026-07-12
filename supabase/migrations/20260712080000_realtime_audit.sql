-- Realtime for the Notifications "Activity" tab (audit_logs). RLS still governs
-- delivery — only owner/manager (+ platform admin) receive events.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='audit_logs') then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end $$;

alter table public.audit_logs replica identity full;
