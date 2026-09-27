-- ============================================================================
-- Dish cost price → gross profit. Part 1: schema, permission, snapshot.
--
-- A small restaurant knows what a plate costs (the owner keeps a ledger:
-- Chicken Momo 90, Buff Choila 170, 8848 full 900 / half 450 / quarter 225)
-- but will not weigh every ingredient into a recipe. Until now the only cost
-- we could compute was Σ recipe.qty × ingredient cost, which 71 of 96 dishes
-- did not have, and nothing was snapshotted on a sale, so no report could
-- answer "what did we actually earn today".
--
-- Three additions:
--   menu_items.cost_cents / item_variants.cost_cents   the direct cost
--   order_items.unit_cost_cents                          the cost at sale time
--   profit.view                                          who may see any of it
--
-- Effective cost of a sold line, in priority order (direct cost wins):
--   1. the variant's own cost_cents                      (8848 90ml = 110)
--   2. the item's cost_cents × variant.recipe_scale      (Half = 0.5 × full)
--   3. Σ recipes.qty × inventory_items.cost_cents × scale (only if mapped)
--   4. null — "uncosted": reports show profit as unknown, never as 100%.
--
-- The snapshot is taken by a BEFORE INSERT trigger on order_items, not inside
-- any one placement RPC: fourteen migrations insert order lines (staff order,
-- amend, QR, split, custom items…) and a cost that only some of them recorded
-- would make the day's profit depend on which screen took the order. Like
-- unit_price_cents, it is frozen at insert — changing a dish's cost later does
-- not rewrite open lines; the owner runs backfill_order_item_costs for that.
--
-- Costs are written through RPCs rather than a table update because the
-- menu_items / item_variants write policies require menu.edit
-- (20260814170000_menu_write_guards.sql), and a store keeper entering costs
-- should not need permission to rename dishes. profit.view is the gate.
--
-- Add-ons (modifiers) are not costed in v1. dashboard_summary is untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column if not exists cost_cents integer
  check (cost_cents is null or cost_cents >= 0);
comment on column public.menu_items.cost_cents is
  'Direct cost to make one base portion. Null = not entered (uncosted).';

alter table public.item_variants
  add column if not exists cost_cents integer
  check (cost_cents is null or cost_cents >= 0);
comment on column public.item_variants.cost_cents is
  'Direct cost of this portion. Null = fall back to item cost × recipe_scale.';

alter table public.order_items
  add column if not exists unit_cost_cents integer;
comment on column public.order_items.unit_cost_cents is
  'Cost per unit snapshotted when the line was inserted. Null = uncosted.';

-- ---------------------------------------------------------------------------
-- Permission: profit.view. Owner-only by default; a manager gets every key
-- except billing.view — and now profit.view — unless the owner grants it from
-- Team → Roles (the editor groups the permissions table by grp, no UI change).
-- ---------------------------------------------------------------------------
insert into public.permissions (key, grp, label, sort) values
  ('profit.view', 'Reports', 'See dish costs & profit', 345)
on conflict (key) do nothing;

create or replace function public.default_role_permissions(_base public.app_role)
returns setof text
language sql
stable
set search_path to 'public'
as $$
  select unnest(
    case _base
      when 'owner' then array(select key from public.permissions)
      when 'manager' then array(select key from public.permissions where key not in ('billing.view', 'profit.view'))
      when 'receptionist' then array['dashboard.view','tables.view','tables.edit','reservations.view','reservations.edit','notifications.view','expenses.create']
      when 'cashier' then array['dashboard.view','tables.view','order.view','order.create','order.fire','checkout.view','payment.take','cash.view','cash.manage','online.view','online.manage','notifications.view','kds.view','expenses.create','expenses.view']
      when 'waiter' then array['dashboard.view','tables.view','order.view','order.create','order.fire','notifications.view','expenses.create']
      when 'kitchen' then array['dashboard.view','kds.view','kds.bump','order.view','expenses.create']
      when 'inventory' then array['dashboard.view','inventory.view','inventory.edit','purchasing.view','purchasing.edit','expenses.create']
      else array[]::text[]
    end
  );
$$;

-- System roles carry explicit rows; only the owner role gets the new key.
insert into public.role_permissions (role_id, permission_key)
select r.id, 'profit.view'
from public.roles r
where r.is_system and r.base_role = 'owner'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Effective cost. Internal only: it answers for any item id it is handed, so
-- an EXECUTE grant would let a member of one restaurant read another's costs.
-- The trigger and the RPCs below are its callers (trigger firing does not
-- check EXECUTE; the RPCs are security definer).
-- ---------------------------------------------------------------------------
create or replace function public.effective_item_cost_cents(_item_id uuid, _variant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select iv.cost_cents, coalesce(iv.recipe_scale, 1) as scale
    from public.item_variants iv
    where iv.id = _variant_id and iv.item_id = _item_id
  ),
  scale as (
    select coalesce((select scale from v), 1) as s
  ),
  recipe as (
    select round(sum(r.qty * ii.cost_cents))::integer as cents
    from public.recipes r
    join public.inventory_items ii on ii.id = r.inventory_item_id
    where r.menu_item_id = _item_id
    having count(r.id) > 0
  )
  select coalesce(
    (select cost_cents from v),
    (select round(mi.cost_cents * (select s from scale))::integer
       from public.menu_items mi where mi.id = _item_id and mi.cost_cents is not null),
    (select round(cents * (select s from scale))::integer from recipe)
  )
  where _item_id is not null;
$$;

revoke execute on function public.effective_item_cost_cents(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot trigger. Custom lines (item_id null) stay uncosted. An explicit
-- value supplied on insert is kept so a future import can carry its own cost.
-- ---------------------------------------------------------------------------
create or replace function public.trg_order_item_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.unit_cost_cents is not null then
    return new;
  end if;
  new.unit_cost_cents := public.effective_item_cost_cents(new.item_id, new.variant_id);
  return new;
end;
$$;

revoke execute on function public.trg_order_item_cost()
  from public, anon, authenticated;

drop trigger if exists trg_order_item_cost on public.order_items;
create trigger trg_order_item_cost
  before insert or update of item_id, variant_id on public.order_items
  for each row execute function public.trg_order_item_cost();

-- ---------------------------------------------------------------------------
-- Writes. Cost changes are price-like (rule #5) so each one lands in
-- audit_logs with the before/after.
-- ---------------------------------------------------------------------------
create or replace function public.set_item_cost(_item_id uuid, _cost_cents integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _old integer;
begin
  select tenant_id, cost_cents into _tenant, _old
  from public.menu_items where id = _item_id;
  if _tenant is null then
    raise exception 'dish not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cost_cents is not null and (_cost_cents < 0 or _cost_cents > 100000000) then
    raise exception 'cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  if _old is not distinct from _cost_cents then
    return;
  end if;

  update public.menu_items set cost_cents = _cost_cents where id = _item_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_change', 'menu_item', _item_id,
          jsonb_build_object('from', _old, 'to', _cost_cents));
end;
$$;

create or replace function public.set_variant_cost(_variant_id uuid, _cost_cents integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _old integer;
begin
  select tenant_id, cost_cents into _tenant, _old
  from public.item_variants where id = _variant_id;
  if _tenant is null then
    raise exception 'variant not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _cost_cents is not null and (_cost_cents < 0 or _cost_cents > 100000000) then
    raise exception 'cost must be between 0 and 1,000,000' using errcode = '22023';
  end if;
  if _old is not distinct from _cost_cents then
    return;
  end if;

  update public.item_variants set cost_cents = _cost_cents where id = _variant_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_change', 'item_variant', _variant_id,
          jsonb_build_object('from', _old, 'to', _cost_cents));
end;
$$;

-- Apply today's costs to every past line that never got one. Idempotent: only
-- null lines are touched, so re-running after entering more costs fills the
-- gaps without rewriting lines that already carry a snapshot.
create or replace function public.backfill_order_item_costs(_tenant uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _n integer;
begin
  if not public.has_permission(_tenant, 'profit.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.order_items oi
  set unit_cost_cents = public.effective_item_cost_cents(oi.item_id, oi.variant_id)
  where oi.tenant_id = _tenant
    and oi.unit_cost_cents is null
    and oi.item_id is not null;
  get diagnostics _n = row_count;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'cost_backfill', 'order_items', null,
          jsonb_build_object('lines', _n));

  return _n;
end;
$$;

-- This project's default privileges hand `anon` its own EXECUTE grant on every
-- new function, so revoke from both, then grant to `authenticated`.
do $$
declare _sig text;
begin
  foreach _sig in array array[
    'public.set_item_cost(uuid, integer)',
    'public.set_variant_cost(uuid, integer)',
    'public.backfill_order_item_costs(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', _sig);
    execute format('revoke all on function %s from anon', _sig);
    execute format('grant execute on function %s to authenticated', _sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Initial backfill: at this point only recipe-derived costs exist, so this
-- fills what it can. Owners re-run via the Costing tab after entering costs.
-- ---------------------------------------------------------------------------
update public.order_items oi
set unit_cost_cents = public.effective_item_cost_cents(oi.item_id, oi.variant_id)
where oi.unit_cost_cents is null
  and oi.item_id is not null;
