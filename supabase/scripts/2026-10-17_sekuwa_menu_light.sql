-- ============================================================================
-- One-off menu data replace — The Sekuwa Station, "Sekuwa_Station_Menu_Light.pdf"
--
-- Requested 2026-10-17 by the owner (tsshetauda@gmail.com). TENANT DATA, not
-- schema, so it lives here and not in supabase/migrations (a migration replays
-- into every environment; this menu exists in exactly one restaurant).
--
-- Two tenants are named "The Sekuwa Station". The real one is hardcoded below
-- by id — never match it by name.
--
-- What it does, in order:
--   1. deletes the 32 dishes that are not on the new menu (owner chose hard
--      delete; Hookah + Coal Hukkha Extra are kept by request). Past bills keep
--      the dish name/price on the line (`order_items.name_snapshot`); only the
--      `item_id` link goes (on delete set null). Recipes/costs on deleted rows
--      cascade away.
--   2. renames/reprices/recategorises every kept dish IN PLACE (same id, so
--      images, recipes, costs and sales links survive) and sets its station.
--   3. inserts the new dishes; rewrites variants where the PDF has sizes.
--   4. renames/creates/deletes categories.
--
-- Spirits keep their peg variants; only "Full" moves to the PDF bottle price.
-- is_86 is cleared on every dish the PDF lists (a relaunch resets the day state).
--
-- Apply: Supabase SQL editor or MCP execute_sql (privileged role, bypasses RLS).
-- One transaction; re-runnable (second run is a no-op). Any name that matches
-- zero or more than one row aborts the whole thing.
-- ============================================================================

begin;

create function pg_temp.t() returns uuid language sql immutable as
  $$ select '2fd2168a-0728-456a-8308-202134599864'::uuid $$;

create function pg_temp.station(_name text) returns uuid language plpgsql as $$
declare _id uuid; _n int;
begin
  select id, count(*) over () into _id, _n from public.kitchen_stations
   where tenant_id = pg_temp.t() and name = _name;
  if _n is distinct from 1 then raise exception 'station "%" matched % rows', _name, coalesce(_n,0); end if;
  return _id;
end $$;

-- Category: rename _old → _new if _old exists, else reuse _new, else create.
create function pg_temp.cat(_new text, _sort int, _old text default null) returns uuid language plpgsql as $$
declare _id uuid; _n int;
begin
  select count(*) into _n from public.menu_categories
   where tenant_id = pg_temp.t() and name in (_new, coalesce(_old, _new));
  if _n > 1 then raise exception 'category "%"/"%" matched % rows', _old, _new, _n; end if;
  if _n = 1 then
    update public.menu_categories set name = _new, sort = _sort, is_active = true
     where tenant_id = pg_temp.t() and name in (_new, coalesce(_old, _new)) returning id into _id;
  else
    insert into public.menu_categories (tenant_id, name, sort, is_active)
     values (pg_temp.t(), _new, _sort, true) returning id into _id;
  end if;
  return _id;
end $$;

create function pg_temp.del_item(_name text) returns void language plpgsql as $$
declare _n int;
begin
  delete from public.menu_items where tenant_id = pg_temp.t() and name = _name;
  get diagnostics _n = row_count;
  if _n > 1 then raise exception '"%" matched % rows — not deleting blind', _name, _n; end if;
  raise notice 'delete % → % row', _name, _n;
end $$;

-- Upsert a dish by name. _old = current name to rename from (null = insert if
-- missing). Matches exactly one of (_old, _new) or aborts.
create function pg_temp.put_item(
  _old text, _new text, _cat uuid, _price int, _veg boolean, _station text
) returns uuid language plpgsql as $$
declare _id uuid; _n int; _st uuid := pg_temp.station(_station);
begin
  select count(*) into _n from public.menu_items
   where tenant_id = pg_temp.t() and name in (_new, coalesce(_old, _new));
  if _n > 1 then raise exception 'dish "%"/"%" matched % rows', _old, _new, _n; end if;
  if _n = 0 and _old is not null then raise exception 'dish "%" (→ "%") not found', _old, _new; end if;
  if _n = 1 then
    update public.menu_items
       set name = _new, category_id = _cat, base_price_cents = _price, is_veg = _veg,
           is_86 = false, is_active = true, updated_at = now()
     where tenant_id = pg_temp.t() and name in (_new, coalesce(_old, _new)) returning id into _id;
  else
    insert into public.menu_items (tenant_id, category_id, name, base_price_cents, is_veg, is_active)
     values (pg_temp.t(), _cat, _new, _price, _veg, true) returning id into _id;
    raise notice 'new dish %', _new;
  end if;
  delete from public.item_station_routes where item_id = _id and station_id <> _st;
  insert into public.item_station_routes (tenant_id, item_id, station_id)
   values (pg_temp.t(), _id, _st) on conflict (item_id, station_id) do nothing;
  return _id;
end $$;

-- Rewrite the variant list: drop names not listed, upsert the rest in order.
create function pg_temp.variants(_item uuid, _names text[], _prices int[]) returns void language plpgsql as $$
declare i int;
begin
  if array_length(_names,1) <> array_length(_prices,1) then raise exception 'variants: arrays differ'; end if;
  delete from public.item_variants where item_id = _item and not (name = any(_names));
  for i in 1 .. array_length(_names,1) loop
    update public.item_variants set price_delta_cents = _prices[i], sort = i
     where item_id = _item and name = _names[i];
    if not found then
      insert into public.item_variants (tenant_id, item_id, name, price_delta_cents, sort)
       values (pg_temp.t(), _item, _names[i], _prices[i], i);
    end if;
  end loop;
end $$;

-- Reprice one existing variant, leave its siblings alone (spirit pegs).
create function pg_temp.variant_price(_item uuid, _name text, _price int) returns void language plpgsql as $$
declare _n int;
begin
  update public.item_variants set price_delta_cents = _price where item_id = _item and name = _name;
  get diagnostics _n = row_count;
  if _n <> 1 then raise exception 'variant "%" on % matched % rows', _name, _item, _n; end if;
end $$;

-- Rename a variant if the old spelling is still there.
create function pg_temp.variant_rename(_item uuid, _old text, _new text) returns void language sql as $$
  update public.item_variants set name = _new where item_id = _item and name = _old and _old <> _new;
$$;

do $$
declare
  c_sekuwa uuid; c_tcc uuid; c_sukuti uuid; c_nonveg uuid; c_khaja uuid; c_veg uuid;
  c_momo uuid; c_egg uuid; c_noodle uuid; c_cig uuid; c_fresh uuid; c_soft uuid; c_hard uuid;
  i uuid; _n int;
  k constant text := 'Kitchen'; g constant text := 'Grill'; b constant text := 'Bar';
begin
  if not exists (select 1 from public.tenants where id = pg_temp.t() and name = 'The Sekuwa Station') then
    raise exception 'tenant % is not The Sekuwa Station — wrong database?', pg_temp.t();
  end if;

  ---------------------------------------------------------------- 1. deletes
  perform pg_temp.del_item(n) from unnest(array[
    'Mutton Khana',
    'Chicken Boil / Fry Sadeko','Chicken Tawa','Chicken Thali','Mutton Pakku','Pork Tawa',
    'Fruit Salad','Mushroom Chilly','Popcorn','Sweet Corn','Veg Boiled',
    'Buff Fried Rice','Chicken Fried Rice','Egg Fried Rice','Mix Fried Rice','Veg Fried Rice',
    'Buff Chowmein','Chicken Chowmein','Veg Chowmein',
    'Egg Maggie Noodle','Maggie Noodle','Plain Maggie Noodle',
    'Buff Sekuwa Khaja Set','Chicken Sekuwa Khaja Set','Pork Sekuwa Khaja Set',
    'Hot Lemon','Hot Lemon with Ginger',
    'Dew (glass)','Redbull Original (big)','Blue Lagoon','Lemonade','Virgin Mojito'
  ]) as n;

  ------------------------------------------------------------- 2. categories
  c_sekuwa := pg_temp.cat('Sekuwa', 0);
  c_tcc    := pg_temp.cat('Tass · Choila · Chilly', 1);
  c_sukuti := pg_temp.cat('Sukuti & Bhutan', 2);
  c_nonveg := pg_temp.cat('Non-Veg Items', 3);
  c_khaja  := pg_temp.cat('Khaja Set', 4);
  c_veg    := pg_temp.cat('Veg Items', 5);
  c_momo   := pg_temp.cat('Momo', 6);
  c_egg    := pg_temp.cat('Egg', 7);
  c_noodle := pg_temp.cat('Noodles', 8, 'Noodles & Eggs');
  c_cig    := pg_temp.cat('Cigarette', 9);
  c_fresh  := pg_temp.cat('Fresh Drinks', 10, 'Beverages');
  c_soft   := pg_temp.cat('Soft Drinks', 11, 'Cold Drinks');
  c_hard   := pg_temp.cat('Hard Drinks', 12, 'Alcohol');

  ----------------------------------------------------------------- Sekuwa
  -- (old, new, cat, base, veg, station) — base 0: the size carries the price
  i := pg_temp.put_item(null,'Chicken Sekuwa', c_sekuwa, 0, false, g);
    perform pg_temp.variant_rename(i,'250gm','250 gm'); perform pg_temp.variant_rename(i,'Half Kg','500 gm'); perform pg_temp.variant_rename(i,'1 Kg','1 kg');
    perform pg_temp.variants(i, array['250 gm','500 gm','1 kg'], array[35000,65000,120000]);
  i := pg_temp.put_item(null,'Buff Sekuwa', c_sekuwa, 0, false, g);
    perform pg_temp.variant_rename(i,'Half Kg','500 gm'); perform pg_temp.variant_rename(i,'1 Kg','1 kg');
    perform pg_temp.variants(i, array['250 gm','500 gm','1 kg'], array[37500,70000,130000]);
  i := pg_temp.put_item(null,'Pork Sekuwa', c_sekuwa, 0, false, g);
    perform pg_temp.variant_rename(i,'Half Kg','500 gm'); perform pg_temp.variant_rename(i,'1 Kg','1 kg');
    perform pg_temp.variants(i, array['250 gm','500 gm','1 kg'], array[40000,75000,140000]);
  i := pg_temp.put_item(null,'Mutton Sekuwa', c_sekuwa, 0, false, g);
    perform pg_temp.variant_rename(i,'Half Kg','500 gm'); perform pg_temp.variant_rename(i,'1 Kg','1 kg');
    perform pg_temp.variants(i, array['250 gm','500 gm','1 kg'], array[50000,90000,170000]);

  ------------------------------------------------- Tass · Choila · Chilly
  perform pg_temp.put_item(null,          'Chicken Tass',   c_tcc, 27500, false, k);
  perform pg_temp.put_item(null,          'Chicken Choila', c_tcc, 25000, false, k);
  perform pg_temp.put_item(null,          'Chicken Chilly', c_tcc, 30000, false, k);
  perform pg_temp.put_item(null,          'Buff Tass',      c_tcc, 32500, false, k);
  perform pg_temp.put_item('Buff Chhoila','Buff Choila',    c_tcc, 30000, false, k);
  perform pg_temp.put_item(null,          'Buff Chilly',    c_tcc, 32500, false, k);
  perform pg_temp.put_item(null,          'Pork Tass',      c_tcc, 35000, false, k);
  perform pg_temp.put_item(null,          'Pork Choila',    c_tcc, 33000, false, k);
  perform pg_temp.put_item(null,          'Pork Chilly',    c_tcc, 35000, false, k);
  perform pg_temp.put_item('Mutton Tas',  'Mutton Tass',    c_tcc, 42500, false, k);
  perform pg_temp.put_item(null,          'Mutton Choila',  c_tcc, 37000, false, k);
  perform pg_temp.put_item(null,          'Mutton Chilly',  c_tcc, 40000, false, k);

  -------------------------------------------------------- Sukuti & Bhutan
  perform pg_temp.put_item('Buff Sukuti',    'Sukuti',        c_sukuti, 30000, false, k);
  perform pg_temp.put_item('Mutton Bhuttan', 'Bhutan',        c_sukuti, 30000, false, k);
  perform pg_temp.put_item(null,             'Sadeko Sukuti', c_sukuti, 35000, false, k);
  perform pg_temp.put_item(null,             'Sadeko Bhutan', c_sukuti, 35000, false, k);

  ---------------------------------------------------------- Non-Veg Items
  perform pg_temp.put_item(null,'Chicken Sausage', c_nonveg,  8000, false, k);
  perform pg_temp.put_item(null,'Chicken Boil',    c_nonveg, 22000, false, k);
  perform pg_temp.put_item(null,'Chicken Sadeko',  c_nonveg, 25000, false, k);
  perform pg_temp.put_item(null,'Chicken Fry',     c_nonveg, 27000, false, k);
  perform pg_temp.put_item(null,'Crispy Chicken',  c_nonveg, 30000, false, k);
  perform pg_temp.put_item(null,'Chicken Roast',   c_nonveg, 35000, false, k);
  perform pg_temp.put_item(null,'Buff Sausage',    c_nonveg,  8000, false, k);
  perform pg_temp.put_item(null,'Buff Boil',       c_nonveg, 25000, false, k);
  perform pg_temp.put_item(null,'Buff Sadeko',     c_nonveg, 27000, false, k);
  perform pg_temp.put_item(null,'Buff Fry',        c_nonveg, 30000, false, k);
  perform pg_temp.put_item(null,'Crispy Buff',     c_nonveg, 35000, false, k);
  perform pg_temp.put_item(null,'Buff Roast',      c_nonveg, 40000, false, k);
  perform pg_temp.put_item(null,'Pork Fry',        c_nonveg, 30000, false, k);
  perform pg_temp.put_item(null,'Crispy Pork',     c_nonveg, 40000, false, k);
  perform pg_temp.put_item(null,'Mutton Fry',      c_nonveg, 35000, false, k);
  perform pg_temp.put_item(null,'Crispy Mutton',   c_nonveg, 50000, false, k);

  -------------------------------------------------------------- Khaja Set
  perform pg_temp.put_item(null,'Veg Khaja Set',     c_khaja, 28000, true,  k);
  perform pg_temp.put_item(null,'Chicken Khaja Set', c_khaja, 35000, false, k);
  perform pg_temp.put_item(null,'Buff Khaja Set',    c_khaja, 35000, false, k);
  perform pg_temp.put_item(null,'Pork Khaja Set',    c_khaja, 37500, false, k);
  perform pg_temp.put_item(null,'Mutton Khaja Set',  c_khaja, 40000, false, k);
  perform pg_temp.put_item('Mix (Mutton, Pork, Buff, Chicken) Sekuwa Khaja Set','Mix Khaja Set', c_khaja, 50000, false, k);

  -------------------------------------------------------------- Veg Items
  perform pg_temp.put_item(null,                 'Papad',                  c_veg, 10000, true,  k);
  perform pg_temp.put_item('Plain Peanuts',      'Plain Peanut',           c_veg, 10000, true,  k);
  perform pg_temp.put_item('Lasun Poleko',       'Lahsun Poleko',          c_veg, 10000, true,  k);
  perform pg_temp.put_item(null,                 'Prawn',                  c_veg, 10000, null,  k);
  perform pg_temp.put_item('WaiWai Sadeko',      'Veg Wai Wai Sadeko',     c_veg, 12000, true,  k);
  perform pg_temp.put_item(null,                 'Non-Veg Wai Wai Sadeko', c_veg, 12000, false, k);
  perform pg_temp.put_item(null,                 'Jira Aalu',              c_veg, 14000, true,  k);
  perform pg_temp.put_item('Peanut Sadeko',      'Sadeko Peanut',          c_veg, 15000, true,  k);
  perform pg_temp.put_item(null,                 'Bhatmas Sadeko',         c_veg, 15000, true,  k);
  perform pg_temp.put_item(null,                 'Onion Pakoda',           c_veg, 15000, true,  k);
  perform pg_temp.put_item(null,                 'Timur Aalu',             c_veg, 18000, true,  k);
  perform pg_temp.put_item(null,                 'French Fry',             c_veg, 20000, true,  k);
  perform pg_temp.put_item('Soyabean Chhoila',   'Soyabean Choila',        c_veg, 20000, true,  k);
  perform pg_temp.put_item(null,                 'Aalu Pakoda',            c_veg, 25000, true,  k);
  perform pg_temp.put_item('French Fries Chilly','French Fry Chilly',      c_veg, 25000, true,  k);
  perform pg_temp.put_item(null,                 'Paneer Fry',             c_veg, 25000, true,  k);
  perform pg_temp.put_item(null,                 'Nepali Green Salad',     c_veg, 25000, true,  k);
  perform pg_temp.put_item(null,                 'Paneer Pakoda',          c_veg, 30000, true,  k);
  perform pg_temp.put_item(null,                 'Soyabean Chilly',        c_veg, 30000, true,  k);
  perform pg_temp.put_item(null,                 'Paneer Chilly',          c_veg, 35000, true,  k);
  perform pg_temp.put_item(null,                 'Paneer Aalu Pakoda',     c_veg, 40000, true,  k);

  ------------------------------------------------------------------- Momo
  i := pg_temp.put_item(null,'Veg Momo',     c_momo, 0, true,  k); perform pg_temp.variants(i, array['Steam','Fry','Jhol'], array[12000,17000,15000]);
  i := pg_temp.put_item(null,'Buff Momo',    c_momo, 0, false, k); perform pg_temp.variants(i, array['Steam','Fry','Jhol'], array[13000,18000,16000]);
  i := pg_temp.put_item(null,'Chicken Momo', c_momo, 0, false, k); perform pg_temp.variants(i, array['Steam','Fry','Jhol'], array[15000,20000,18000]);

  -------------------------------------------------------------------- Egg
  i := pg_temp.put_item('Boil Egg','Boiled Egg',  c_egg, 0, false, k); perform pg_temp.variants(i, array['1 pc','2 pc'], array[5000, 8000]);
  i := pg_temp.put_item(null,'Plain Omelet',      c_egg, 0, false, k); perform pg_temp.variants(i, array['1 pc','2 pc'], array[6000,10000]);
  i := pg_temp.put_item(null,'Masala Omelet',     c_egg, 0, false, k); perform pg_temp.variants(i, array['1 pc','2 pc'], array[8000,15000]);

  ---------------------------------------------------------------- Noodles
  i := pg_temp.put_item(null,'Wai Wai (Boiled)',                 c_noodle, 0, true,  k); perform pg_temp.variants(i, array['Single','Double'], array[ 4000, 7500]);
  i := pg_temp.put_item(null,'Mix Wai Wai (Veg)',                c_noodle, 0, true,  k); perform pg_temp.variants(i, array['Single','Double'], array[ 5000, 9000]);
  i := pg_temp.put_item(null,'Egg Wai Wai',                      c_noodle, 0, false, k); perform pg_temp.variants(i, array['Single','Double'], array[ 9000,17000]);
  i := pg_temp.put_item(null,'Egg Wai Wai w/ Buff Sausage',      c_noodle, 0, false, k); perform pg_temp.variants(i, array['Single','Double'], array[12500,25000]);
  i := pg_temp.put_item(null,'Egg Wai Wai w/ Chicken Sausage',   c_noodle, 0, false, k); perform pg_temp.variants(i, array['Single','Double'], array[13500,27000]);
  i := pg_temp.put_item('Plain Current Noodle','Current (Boiled)', c_noodle, 0, true, k); perform pg_temp.variants(i, array['Single','Double'], array[ 8500,16000]);
  i := pg_temp.put_item(null,'Mix Veg Current',                  c_noodle, 0, true,  k); perform pg_temp.variants(i, array['Single','Double'], array[10000,21000]);
  i := pg_temp.put_item('Egg Current Noodle','Egg Current (Mix Veg)', c_noodle, 0, false, k); perform pg_temp.variants(i, array['Single','Double'], array[13500,26000]);
  i := pg_temp.put_item('Sausage Egg Current Noodle','Egg Current w/ Buff Sausage', c_noodle, 0, false, k); perform pg_temp.variants(i, array['Single','Double'], array[16000,31000]);

  -------------------------------------------------------------- Cigarette
  perform pg_temp.put_item(null,   'Shikhar Ice',  c_cig, 2500, null, b);
  perform pg_temp.put_item('Surya','Surya Luxury', c_cig, 3000, null, b);
  -- Hookah, Coal Hukkha Extra: untouched (owner keeps them).

  ----------------------------------------------------------- Fresh Drinks
  perform pg_temp.put_item(null,'Black Tea',            c_fresh,  5000, true, b);
  perform pg_temp.put_item(null,'Lemon Tea',            c_fresh,  5000, true, b);
  perform pg_temp.put_item(null,'Milk Tea',             c_fresh,  5000, true, b);
  perform pg_temp.put_item(null,'Black Coffee',         c_fresh,  5000, true, b);
  perform pg_temp.put_item(null,'Milk Coffee',          c_fresh,  7000, true, b);
  perform pg_temp.put_item(null,'Hot Lemon with Honey', c_fresh, 10000, true, b);

  ------------------------------------------------------------ Soft Drinks
  perform pg_temp.put_item(null,                      'Hot Water',     c_soft,  1000, true, b);
  perform pg_temp.put_item('Water (bottle)',          'Water',         c_soft,  3000, true, b);
  perform pg_temp.put_item('Coke (glass)',            'Coke',          c_soft, 10000, true, b);
  perform pg_temp.put_item('Fanta (glass)',           'Fanta',         c_soft, 10000, true, b);
  perform pg_temp.put_item(null,                      'Sprite',        c_soft, 10000, true, b);
  perform pg_temp.put_item(null,                      'Plain Lassi',   c_soft, 12000, true, b);
  perform pg_temp.put_item(null,                      'Special Lassi', c_soft, 18000, true, b);
  perform pg_temp.put_item('Redbull Original (small)','Red Bull',      c_soft, 18000, true, b);
  perform pg_temp.put_item(null,                      'Xtreme',        c_soft, 20000, true, b);

  ------------------------------------------------------------ Hard Drinks
  perform pg_temp.put_item(null,         'Barahsinghe',     c_hard,  50000, null, b);
  perform pg_temp.put_item(null,         'Gorkha Beer',     c_hard,  50000, null, b);
  perform pg_temp.put_item('Tuborg Beer','Tuborg',          c_hard,  55000, null, b);
  perform pg_temp.put_item(null,         'Big Master Wine', c_hard, 150000, null, b);
  perform pg_temp.put_item(null,         'Old Monk',        c_hard, 300000, null, b);
  perform pg_temp.put_item(null,         'Ruslan',          c_hard, 320000, null, b);
  -- spirits with pegs: base stays 0, only "Full" moves
  i := pg_temp.put_item(null,'Khukuri Rum', c_hard, 0, null, b);                perform pg_temp.variant_price(i,'Full',300000);
  i := pg_temp.put_item(null,'8848 Vodka',  c_hard, 0, null, b);                perform pg_temp.variant_price(i,'Full',320000);
  i := pg_temp.put_item('Old Durbar Whisky','Old Durbar', c_hard, 0, null, b);  perform pg_temp.variant_price(i,'Full',380000);
  i := pg_temp.put_item(null,'Signature',   c_hard, 0, null, b);                perform pg_temp.variant_price(i,'Full',400000);

  ---------------------------------------------------- 4. category cleanup
  delete from public.menu_categories mc
   where mc.tenant_id = pg_temp.t()
     and mc.name in ('Khana','Fried Rice','Chowmein','Lassi & Mocktails')
     and not exists (select 1 from public.menu_items mi where mi.category_id = mc.id);
  get diagnostics _n = row_count;
  raise notice 'categories removed: %', _n;

  -- nothing may be left outside the 13 new categories
  select count(*) into _n from public.menu_items mi
   where mi.tenant_id = pg_temp.t()
     and (mi.category_id is null or mi.category_id not in
          (c_sekuwa,c_tcc,c_sukuti,c_nonveg,c_khaja,c_veg,c_momo,c_egg,c_noodle,c_cig,c_fresh,c_soft,c_hard));
  if _n <> 0 then raise exception '% dishes left outside the new categories — check the delete list', _n; end if;

  select count(*) into _n from public.menu_items where tenant_id = pg_temp.t();
  raise notice 'done: % dishes, % categories', _n,
    (select count(*) from public.menu_categories where tenant_id = pg_temp.t());
end $$;

commit;

-- Preview --------------------------------------------------------------------
-- select mc.sort, mc.name as category, mi.name, mi.base_price_cents/100 as price, mi.is_veg,
--        (select string_agg(v.name||' '||v.price_delta_cents/100, ' / ' order by v.sort) from item_variants v where v.item_id = mi.id) as sizes,
--        (select string_agg(ks.name, ',') from item_station_routes r join kitchen_stations ks on ks.id = r.station_id where r.item_id = mi.id) as station
-- from menu_items mi join menu_categories mc on mc.id = mi.category_id
-- where mi.tenant_id = '2fd2168a-0728-456a-8308-202134599864'
-- order by mc.sort, mi.name;
