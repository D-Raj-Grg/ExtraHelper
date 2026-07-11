-- ============================================================================
-- RLS isolation regression test (rule #1 — tenant A cannot touch tenant B).
-- Self-contained + non-destructive: sets up a rival tenant, becomes an
-- authenticated NON-member, asserts it can neither read nor write the rival's
-- rows, then ROLLS BACK. Raises an exception on any failure; prints PASS on
-- success. Run via `supabase db execute` / psql / the SQL editor.
-- ============================================================================

begin;

-- Setup (privileged role bypasses RLS): a rival tenant + a private row.
insert into public.tenants (id, name, slug, status)
values ('f0000000-0000-0000-0000-0000000000f0', 'Rival', 'rival-isolation-test', 'active');
insert into public.menu_categories (tenant_id, name)
values ('f0000000-0000-0000-0000-0000000000f0', 'Secret Recipes');

-- Become an authenticated user who is a member of NOTHING.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

do $$
begin
  -- Read isolation ----------------------------------------------------------
  if exists (select 1 from public.tenants
             where id = 'f0000000-0000-0000-0000-0000000000f0') then
    raise exception 'FAIL: non-member can read rival tenant row';
  end if;

  if (select count(*) from public.menu_categories
      where tenant_id = 'f0000000-0000-0000-0000-0000000000f0') <> 0 then
    raise exception 'FAIL: non-member can read rival menu rows';
  end if;

  -- Write isolation ---------------------------------------------------------
  begin
    insert into public.menu_categories (tenant_id, name)
    values ('f0000000-0000-0000-0000-0000000000f0', 'Injected');
    raise exception 'FAIL: non-member INSERT into rival tenant was allowed';
  exception
    when insufficient_privilege then null;  -- expected: RLS WITH CHECK blocked it
  end;

  -- Role helper -------------------------------------------------------------
  if public.has_tenant_role('f0000000-0000-0000-0000-0000000000f0', 'owner') then
    raise exception 'FAIL: has_tenant_role() true for a non-member';
  end if;

  raise notice 'PASS: RLS tenant isolation holds (read + write + role helper)';
end $$;

rollback;
