-- Align the five RPCs with the permission keys the UI gates on: base role OR the .edit key,
-- so a receptionist (holds tables.edit / reservations.edit) or a custom role is not refused.
do $$
declare
  r record; def text;
begin
  for r in
    select p.oid, p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_floor', 'create_table', 'delete_table', 'create_reservation', 'set_reservation_status')
  loop
    def := pg_get_functiondef(r.oid);
    if r.proname in ('create_floor', 'create_table', 'delete_table') then
      def := replace(def,
        'public.has_tenant_role(_tenant, ''owner'', ''manager'')',
        '(public.has_tenant_role(_tenant, ''owner'', ''manager'') or public.has_permission(_tenant, ''tables.edit''))');
    else
      def := replace(def,
        'public.has_tenant_role(_tenant, ''owner'', ''manager'', ''receptionist'')',
        '(public.has_tenant_role(_tenant, ''owner'', ''manager'', ''receptionist'') or public.has_permission(_tenant, ''reservations.edit''))');
    end if;
    if def not like '%has_permission%' then
      raise exception 'patch did not apply to %', r.proname;
    end if;
    execute def;
  end loop;
end $$;
