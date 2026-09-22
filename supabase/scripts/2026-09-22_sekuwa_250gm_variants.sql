-- ============================================================================
-- One-off menu data fix — drop the "1 Jir" portion, add "250 gm"
--
-- Requested 2026-09-22. This is TENANT DATA, not schema, so it deliberately
-- lives here and not in supabase/migrations: a migration replays into every
-- environment, and these four dishes exist in exactly one restaurant.
--
-- Apply: paste into the Supabase SQL editor (runs as a privileged role, so it
-- bypasses RLS), or `psql -f` against the project. Wrapped in a transaction —
-- nothing lands unless every rule below matches exactly one dish.
--
-- Idempotent: re-running deletes nothing further and repricing "250 gm" to the
-- same figure is a no-op.
--
-- ⚠ Deleting a variant is not free. `order_items.variant_id` is
--   `on delete set null`, so past orders stop recording that they were sold as
--   "1 Jir" (the line's name and price on the bill are unaffected — those are
--   copied onto the order line). Reports by size lose that history. This is the
--   same consequence the menu editor's delete dialog names.
-- ============================================================================

begin;

do $$
declare
  -- Leave null to auto-resolve: the single tenant that owns a "1 Jir" variant.
  -- Set it explicitly (e.g. '00000000-…') if more than one restaurant has one.
  _tenant uuid := null;

  -- name pattern A, name pattern B (null = unused), new "250 gm" delta in cents
  _rules  text[][] := array[
    array['%buff%',    '%sekuwa%', '35000'],
    array['%chicken%', '%sekuwa%', '35000'],
    array['%mutton%',  null,       '60000'],
    array['%pork%',    null,       '40000']
  ];

  _r        text[];
  _item     uuid;
  _item_nm  text;
  _matches  int;
  _delta    int;
  _dropped  int;
  _variant  uuid;
begin
  ------------------------------------------------------------------ tenant ---
  -- Resolved from the "1 Jir" variant on a first run, and from the sekuwa
  -- dishes themselves on a re-run, once every "1 Jir" is already gone —
  -- otherwise the second run would abort instead of confirming the first.
  if _tenant is null then
    select count(distinct tenant_id) into _matches
    from public.item_variants
    where lower(regexp_replace(name, '\s+', '', 'g')) = '1jir';

    if _matches = 0 then
      select count(distinct tenant_id) into _matches
      from public.menu_items where name ilike '%sekuwa%';

      if _matches = 0 then
        raise exception
          'no "1 Jir" variant and no sekuwa dish anywhere — wrong database, or '
          'the names differ; run the preview query at the bottom of this file first';
      end if;
    end if;

    -- `select … into` takes the first row silently when there are several,
    -- which would quietly reprice the wrong restaurant's menu.
    if _matches > 1 then
      raise exception 'more than one tenant matches — set _tenant explicitly';
    end if;

    select coalesce(
      (select distinct tenant_id from public.item_variants
       where lower(regexp_replace(name, '\s+', '', 'g')) = '1jir'),
      (select distinct tenant_id from public.menu_items where name ilike '%sekuwa%')
    ) into _tenant;
  end if;

  raise notice 'tenant %', _tenant;

  ------------------------------------------------- 1. drop every "1 Jir" -----
  -- Matched on the squashed, lower-cased name so "1 Jir", "1 JIR" and "1jir"
  -- all go. Scoped to the one tenant.
  with gone as (
    delete from public.item_variants
    where tenant_id = _tenant
      and lower(regexp_replace(name, '\s+', '', 'g')) = '1jir'
    returning item_id
  )
  select count(*) into _dropped from gone;
  raise notice 'dropped % "1 Jir" variant(s)', _dropped;

  ------------------------------------------- 2. add / reprice "250 gm" -------
  foreach _r slice 1 in array _rules loop
    _delta := _r[3]::int;

    select count(*) into _matches
    from public.menu_items i
    where i.tenant_id = _tenant
      and i.name ilike _r[1]
      and (_r[2] is null or i.name ilike _r[2]);

    -- Refuse rather than guess: "%pork%" would happily also hit "Pork Momo",
    -- and a silently mispriced dish is worse than a failed script.
    if _matches <> 1 then
      raise exception
        'pattern % / % matched % dishes, expected 1 — fix the pattern and re-run',
        _r[1], coalesce(_r[2], '—'), _matches;
    end if;

    select i.id, i.name into _item, _item_nm
    from public.menu_items i
    where i.tenant_id = _tenant
      and i.name ilike _r[1]
      and (_r[2] is null or i.name ilike _r[2]);

    select v.id into _variant
    from public.item_variants v
    where v.item_id = _item
      and lower(regexp_replace(v.name, '\s+', '', 'g')) = '250gm';

    if _variant is null then
      -- Appends at the bottom, exactly as public.add_variant does.
      insert into public.item_variants (tenant_id, item_id, name, price_delta_cents, sort)
      values (
        _tenant, _item, '250 gm', _delta,
        coalesce((select max(sort) from public.item_variants where item_id = _item), 0) + 1
      );
      raise notice 'added   "250 gm" +% to %', (_delta / 100.0)::numeric(12,2), _item_nm;
    else
      update public.item_variants
      set name = '250 gm', price_delta_cents = _delta
      where id = _variant;
      raise notice 'updated "250 gm" +% on %', (_delta / 100.0)::numeric(12,2), _item_nm;
    end if;
  end loop;
end $$;

commit;

-- ============================================================================
-- Preview / verify. Safe to run on its own before and after the block above.
-- ============================================================================
-- select i.name as dish, v.name as size, v.price_delta_cents, v.sort,
--        i.base_price_cents + v.price_delta_cents as sells_for
-- from public.item_variants v
-- join public.menu_items i on i.id = v.item_id
-- where i.name ilike any (array['%sekuwa%', '%mutton%', '%pork%'])
-- order by i.name, v.sort;
