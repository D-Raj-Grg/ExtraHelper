-- ============================================================================
-- Daily expenses + simple day close.
--
-- Small restaurants run a paper "daily book": Rs 100 rice, Rs 100 ride-share
-- for the dishwasher, and at night "cash left 100, online 1000". They do not
-- open a cash drawer session, so cash_movements (which needs an open session)
-- never fit them. This adds:
--
--   * expense_categories  — per-tenant, editable, seeded with sensible defaults
--   * expenses            — the ledger; works with or without a drawer
--   * day_closings        — the night-time count (cash left, online received)
--   * tenant_settings.cash_drawer_enabled — hides the drawer for those who
--     don't use it. Defaults off; switched on for tenants that already have
--     cash sessions so nobody loses a screen they rely on.
--
-- When the drawer IS enabled and the logger holds an open session, a cash
-- expense also writes a linked, auto-approved cash_movements payout, so the
-- drawer's expected cash stays right without double entry.
--
-- daily_report_build is renamed to daily_report_core and wrapped, so the
-- report gains 'expenses' and 'cash_book' keys without copying its body.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Setting
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists cash_drawer_enabled boolean not null default false;

update public.tenant_settings s
set cash_drawer_enabled = true
where exists (select 1 from public.cash_sessions cs where cs.tenant_id = s.tenant_id);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  sort        integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists expense_categories_tenant_name_key
  on public.expense_categories (tenant_id, lower(name));

do $$ begin
  create type public.expense_paid_from as enum ('cash', 'online', 'owner');
exception when duplicate_object then null; end $$;

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  branch_id        uuid references public.branches(id) on delete set null,
  business_date    date not null,
  category_id      uuid not null references public.expense_categories(id),
  amount_cents     integer not null check (amount_cents > 0),
  note             text not null check (length(btrim(note)) between 1 and 280),
  paid_from        public.expense_paid_from not null default 'cash',
  receipt_path     text,
  cash_movement_id uuid references public.cash_movements(id) on delete set null,
  client_key       uuid,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references auth.users(id),
  void_reason      text
);
create index if not exists idx_expenses_tenant_day
  on public.expenses (tenant_id, business_date desc);
create unique index if not exists expenses_tenant_client_key
  on public.expenses (tenant_id, client_key) where client_key is not null;

create table if not exists public.day_closings (
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  business_date        date not null,
  cash_counted_cents   integer not null check (cash_counted_cents >= 0),
  online_counted_cents integer check (online_counted_cents >= 0),
  note                 text check (note is null or length(note) <= 280),
  closed_by            uuid not null references auth.users(id),
  closed_at            timestamptz not null default now(),
  primary key (tenant_id, business_date)
);

-- ---------------------------------------------------------------------------
-- RLS: read only. Every write goes through an RPC below.
-- ---------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.day_closings       enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (exists (select 1 from public.user_tenants ut
                 where ut.user_id = auth.uid() and ut.tenant_id = expense_categories.tenant_id
                   and ut.status = 'active'));

-- Anyone may log; only expenses.view sees everyone's. The rest see their own.
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (
    exists (select 1 from public.user_tenants ut
            where ut.user_id = auth.uid() and ut.tenant_id = expenses.tenant_id
              and ut.status = 'active')
    and (created_by = auth.uid() or public.has_permission(tenant_id, 'expenses.view'))
  );

drop policy if exists day_closings_select on public.day_closings;
create policy day_closings_select on public.day_closings
  for select to authenticated
  using (public.has_permission(tenant_id, 'reports.view'));

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
insert into public.permissions (key, grp, label, sort) values
  ('expenses.create', 'Expenses', 'Log daily expenses', 220),
  ('expenses.view',   'Expenses', 'See all expenses and totals', 221),
  ('expenses.manage', 'Expenses', 'Edit or void any expense, manage categories', 222)
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
      when 'manager' then array(select key from public.permissions where key <> 'billing.view')
      when 'receptionist' then array['dashboard.view','tables.view','tables.edit','reservations.view','reservations.edit','notifications.view','expenses.create']
      when 'cashier' then array['dashboard.view','tables.view','order.view','order.create','order.fire','checkout.view','payment.take','cash.view','cash.manage','online.view','online.manage','notifications.view','kds.view','expenses.create','expenses.view']
      when 'waiter' then array['dashboard.view','tables.view','order.view','order.create','order.fire','notifications.view','expenses.create']
      when 'kitchen' then array['dashboard.view','kds.view','kds.bump','order.view','expenses.create']
      when 'inventory' then array['dashboard.view','inventory.view','inventory.edit','purchasing.view','purchasing.edit','expenses.create']
      else array[]::text[]
    end
  );
$$;

-- System roles carry explicit rows; backfill them from the defaults.
insert into public.role_permissions (role_id, permission_key)
select r.id, k.key
from public.roles r
cross join lateral public.default_role_permissions(r.base_role) k(key)
where r.is_system and k.key like 'expenses.%'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Default categories
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_expense_categories()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.expense_categories (tenant_id, name, sort)
  select new.id, c.name, c.sort
  from (values
    ('Groceries', 10), ('Vegetables & Meat', 20), ('Gas / Fuel', 30),
    ('Transport / Ride', 40), ('Utilities', 50), ('Staff food', 60),
    ('Repairs', 70), ('Other', 999)
  ) as c(name, sort)
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.seed_default_expense_categories() from public, anon, authenticated;

drop trigger if exists trg_seed_default_expense_categories on public.tenants;
create trigger trg_seed_default_expense_categories
  after insert on public.tenants
  for each row execute function public.seed_default_expense_categories();

insert into public.expense_categories (tenant_id, name, sort)
select t.id, c.name, c.sort
from public.tenants t
cross join (values
  ('Groceries', 10), ('Vegetables & Meat', 20), ('Gas / Fuel', 30),
  ('Transport / Ride', 40), ('Utilities', 50), ('Staff food', 60),
  ('Repairs', 70), ('Other', 999)
) as c(name, sort)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.tenant_business_today(_tenant uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.business_day(now(), coalesce(s.timezone, 'UTC'), coalesce(s.day_cutoff_minutes, 0))
  from public.tenant_settings s where s.tenant_id = _tenant
  union all select (now() at time zone 'UTC')::date
  limit 1;
$$;
-- Internal: only the definer RPCs below call it.
revoke execute on function public.tenant_business_today(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.record_expense(
  _tenant        uuid,
  _category      uuid,
  _amount_cents  integer,
  _note          text,
  _paid_from     public.expense_paid_from default 'cash',
  _business_date date default null,
  _client_key    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _today date := public.tenant_business_today(_tenant);
  _day date := coalesce(_business_date, _today);
  _id uuid; _session uuid; _branch uuid; _mv uuid; _cat_name text;
begin
  if not public.has_permission(_tenant, 'expenses.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Replayed from an offline outbox: hand back the row that already landed.
  if _client_key is not null then
    select id into _id from public.expenses where tenant_id = _tenant and client_key = _client_key;
    if _id is not null then return _id; end if;
  end if;

  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if coalesce(btrim(_note), '') = '' then
    raise exception 'say what it was for' using errcode = '22023';
  end if;
  if length(_note) > 280 then
    raise exception 'note is too long' using errcode = '22001';
  end if;
  if _day > _today then
    raise exception 'cannot log an expense for a future day' using errcode = '22023';
  end if;
  if _day < _today and not public.has_permission(_tenant, 'expenses.manage') then
    raise exception 'only a manager can log an expense for an earlier day' using errcode = '42501';
  end if;

  select name into _cat_name from public.expense_categories
  where id = _category and tenant_id = _tenant and archived_at is null;
  if _cat_name is null then
    raise exception 'pick a category' using errcode = '22023';
  end if;

  -- Drawer mode: a cash expense today comes out of the logger's open drawer.
  if _paid_from = 'cash' and _day = _today and exists (
    select 1 from public.tenant_settings where tenant_id = _tenant and cash_drawer_enabled
  ) then
    select id, branch_id into _session, _branch
    from public.cash_sessions
    where cashier_id = _uid and status = 'open' and tenant_id = _tenant
    order by opened_at desc limit 1;

    if _session is not null then
      insert into public.cash_movements
        (tenant_id, branch_id, session_id, kind, category, amount_cents, note,
         status, created_by, approved_by, approved_at, auto_approved)
      values (_tenant, _branch, _session, 'payout', 'other', _amount_cents,
              left(_cat_name || ' — ' || btrim(_note), 280),
              'approved', _uid, _uid, now(), true)
      returning id into _mv;
    end if;
  end if;

  insert into public.expenses
    (tenant_id, branch_id, business_date, category_id, amount_cents, note,
     paid_from, cash_movement_id, client_key, created_by)
  values (_tenant, _branch, _day, _category, _amount_cents, btrim(_note),
          _paid_from, _mv, _client_key, _uid)
  returning id into _id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, _uid, 'expense_create', 'expense', _id,
          jsonb_build_object('amount_cents', _amount_cents, 'category', _cat_name,
                             'paid_from', _paid_from, 'business_date', _day,
                             'cash_movement_id', _mv));
  return _id;
end $$;

revoke execute on function public.record_expense(uuid, uuid, integer, text, public.expense_paid_from, date, uuid) from anon, public;
grant  execute on function public.record_expense(uuid, uuid, integer, text, public.expense_paid_from, date, uuid) to authenticated;

-- Creator may fix their own entry on the same business day; expenses.manage
-- may fix anything.
create or replace function public.assert_may_change_expense(_e public.expenses)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.has_permission(_e.tenant_id, 'expenses.manage') then return; end if;
  if _e.created_by = auth.uid()
     and _e.business_date = public.tenant_business_today(_e.tenant_id)
     and public.has_permission(_e.tenant_id, 'expenses.create') then
    return;
  end if;
  raise exception 'only a manager can change this expense' using errcode = '42501';
end $$;
revoke execute on function public.assert_may_change_expense(public.expenses) from public, anon, authenticated;

create or replace function public.update_expense(
  _id           uuid,
  _category     uuid,
  _amount_cents integer,
  _note         text,
  _paid_from    public.expense_paid_from
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _e public.expenses; _cat_name text;
begin
  select * into _e from public.expenses where id = _id for update;
  if _e.id is null then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  perform public.assert_may_change_expense(_e);
  if _e.voided_at is not null then
    raise exception 'this expense was voided' using errcode = '22023';
  end if;
  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if coalesce(btrim(_note), '') = '' then
    raise exception 'say what it was for' using errcode = '22023';
  end if;
  if length(_note) > 280 then
    raise exception 'note is too long' using errcode = '22001';
  end if;
  select name into _cat_name from public.expense_categories
  where id = _category and tenant_id = _e.tenant_id;
  if _cat_name is null then
    raise exception 'pick a category' using errcode = '22023';
  end if;

  update public.expenses
  set category_id = _category, amount_cents = _amount_cents, note = btrim(_note),
      paid_from = _paid_from, updated_at = now()
  where id = _id;

  -- Keep a linked drawer payout in step while its session is still open. A
  -- closed session's count is history and is left alone.
  if _e.cash_movement_id is not null then
    if _paid_from = 'cash' then
      update public.cash_movements m
      set amount_cents = _amount_cents, note = left(_cat_name || ' — ' || btrim(_note), 280)
      from public.cash_sessions s
      where m.id = _e.cash_movement_id and s.id = m.session_id and s.status = 'open';
    else
      update public.cash_movements m
      set status = 'rejected'
      from public.cash_sessions s
      where m.id = _e.cash_movement_id and s.id = m.session_id and s.status = 'open';
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_e.tenant_id, _uid, 'expense_update', 'expense', _id,
          jsonb_build_object('before', jsonb_build_object('amount_cents', _e.amount_cents,
                               'category_id', _e.category_id, 'paid_from', _e.paid_from, 'note', _e.note),
                             'after', jsonb_build_object('amount_cents', _amount_cents,
                               'category_id', _category, 'paid_from', _paid_from, 'note', btrim(_note))));
end $$;

revoke execute on function public.update_expense(uuid, uuid, integer, text, public.expense_paid_from) from anon, public;
grant  execute on function public.update_expense(uuid, uuid, integer, text, public.expense_paid_from) to authenticated;

create or replace function public.void_expense(_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _e public.expenses;
begin
  select * into _e from public.expenses where id = _id for update;
  if _e.id is null then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  perform public.assert_may_change_expense(_e);
  if _e.voided_at is not null then return; end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  update public.expenses
  set voided_at = now(), voided_by = _uid, void_reason = left(btrim(_reason), 280), updated_at = now()
  where id = _id;

  if _e.cash_movement_id is not null then
    update public.cash_movements m
    set status = 'rejected'
    from public.cash_sessions s
    where m.id = _e.cash_movement_id and s.id = m.session_id and s.status = 'open';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_e.tenant_id, _uid, 'expense_void', 'expense', _id,
          jsonb_build_object('amount_cents', _e.amount_cents, 'reason', btrim(_reason)));
end $$;

revoke execute on function public.void_expense(uuid, text) from anon, public;
grant  execute on function public.void_expense(uuid, text) to authenticated;

create or replace function public.upsert_expense_category(_tenant uuid, _id uuid, _name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _out uuid;
begin
  if not public.has_permission(_tenant, 'expenses.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(btrim(_name), '') = '' or length(btrim(_name)) > 60 then
    raise exception 'name must be 1–60 characters' using errcode = '22023';
  end if;

  if _id is null then
    insert into public.expense_categories (tenant_id, name, sort)
    values (_tenant, btrim(_name),
            coalesce((select max(sort) from public.expense_categories
                      where tenant_id = _tenant and sort < 999), 0) + 10)
    on conflict (tenant_id, lower(name)) do update set archived_at = null
    returning id into _out;
  else
    update public.expense_categories set name = btrim(_name), archived_at = null
    where id = _id and tenant_id = _tenant
    returning id into _out;
    if _out is null then
      raise exception 'category not found' using errcode = 'P0002';
    end if;
  end if;
  return _out;
exception when unique_violation then
  raise exception 'a category with that name already exists' using errcode = '23505';
end $$;

revoke execute on function public.upsert_expense_category(uuid, uuid, text) from anon, public;
grant  execute on function public.upsert_expense_category(uuid, uuid, text) to authenticated;

create or replace function public.archive_expense_category(_tenant uuid, _id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_permission(_tenant, 'expenses.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.expense_categories set archived_at = now()
  where id = _id and tenant_id = _tenant and archived_at is null;
end $$;

revoke execute on function public.archive_expense_category(uuid, uuid) from anon, public;
grant  execute on function public.archive_expense_category(uuid, uuid) to authenticated;

create or replace function public.close_day(
  _tenant               uuid,
  _day                  date,
  _cash_counted_cents   integer,
  _online_counted_cents integer default null,
  _note                 text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _uid uuid := auth.uid();
begin
  if not public.has_permission(_tenant, 'reports.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if _day is null or _day > public.tenant_business_today(_tenant) then
    raise exception 'cannot close a future day' using errcode = '22023';
  end if;
  if _cash_counted_cents is null or _cash_counted_cents < 0
     or coalesce(_online_counted_cents, 0) < 0 then
    raise exception 'amounts cannot be negative' using errcode = '22023';
  end if;

  insert into public.day_closings
    (tenant_id, business_date, cash_counted_cents, online_counted_cents, note, closed_by, closed_at)
  values (_tenant, _day, _cash_counted_cents, _online_counted_cents,
          nullif(left(btrim(coalesce(_note, '')), 280), ''), _uid, now())
  on conflict (tenant_id, business_date) do update
    set cash_counted_cents = excluded.cash_counted_cents,
        online_counted_cents = excluded.online_counted_cents,
        note = excluded.note, closed_by = excluded.closed_by, closed_at = excluded.closed_at;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, _uid, 'day_close', 'day', null,
          jsonb_build_object('business_date', _day, 'cash_counted_cents', _cash_counted_cents,
                             'online_counted_cents', _online_counted_cents));
end $$;

revoke execute on function public.close_day(uuid, date, integer, integer, text) from anon, public;
grant  execute on function public.close_day(uuid, date, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Report: wrap the existing builder and add expenses + cash book.
-- ---------------------------------------------------------------------------
alter function public.daily_report_build(uuid, date) rename to daily_report_core;
revoke execute on function public.daily_report_core(uuid, date) from public, anon, authenticated;

create or replace function public.daily_report_build(_tenant uuid, _day date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _core jsonb := public.daily_report_core(_tenant, _day);
  _d date := (_core->>'day')::date;
  _from timestamptz := (_core->>'from')::timestamptz;
  _to timestamptz := (_core->>'to')::timestamptz;
  _drawer boolean;
  _cash_in bigint; _online_in bigint; _cash_ref bigint; _online_ref bigint;
  _cash_exp bigint; _online_exp bigint; _owner_exp bigint;
  _close public.day_closings;
  _expected_cash bigint; _expected_online bigint;
begin
  select coalesce(cash_drawer_enabled, false) into _drawer
  from public.tenant_settings where tenant_id = _tenant;

  select coalesce(sum(amount_cents) filter (where method = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where method not in ('cash', 'points')), 0)
    into _cash_in, _online_in
  from public.payments
  where tenant_id = _tenant and status = 'completed'
    and created_at >= _from and created_at < _to;

  select coalesce(sum(amount_cents) filter (where method::text = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where method is not null and method::text not in ('cash', 'points')), 0)
    into _cash_ref, _online_ref
  from public.refunds
  where tenant_id = _tenant and created_at >= _from and created_at < _to;

  select coalesce(sum(amount_cents) filter (where paid_from = 'cash'), 0),
         coalesce(sum(amount_cents) filter (where paid_from = 'online'), 0),
         coalesce(sum(amount_cents) filter (where paid_from = 'owner'), 0)
    into _cash_exp, _online_exp, _owner_exp
  from public.expenses
  where tenant_id = _tenant and business_date = _d and voided_at is null;

  select * into _close from public.day_closings where tenant_id = _tenant and business_date = _d;

  _expected_cash   := _cash_in - _cash_ref - _cash_exp;
  _expected_online := _online_in - _online_ref - _online_exp;

  return _core || jsonb_build_object(
    'cash_drawer_enabled', coalesce(_drawer, false),
    'expenses', jsonb_build_object(
      'total_cents', _cash_exp + _online_exp + _owner_exp,
      'count', (select count(*) from public.expenses
                where tenant_id = _tenant and business_date = _d and voided_at is null),
      'by_paid_from', jsonb_build_object('cash', _cash_exp, 'online', _online_exp, 'owner', _owner_exp),
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('name', x.name, 'amount_cents', x.amt, 'count', x.n)
                         order by x.amt desc)
        from (select c.name, sum(e.amount_cents)::bigint amt, count(*)::bigint n
              from public.expenses e join public.expense_categories c on c.id = e.category_id
              where e.tenant_id = _tenant and e.business_date = _d and e.voided_at is null
              group by c.name) x
      ), '[]'::jsonb),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'at', e.created_at,
                 'time', to_char(e.created_at at time zone (_core->>'timezone'), 'HH24:MI'),
                 'category', c.name, 'note', e.note, 'amount_cents', e.amount_cents,
                 'paid_from', e.paid_from,
                 'by', coalesce(pr.full_name, case when pr.username is not null then '@' || pr.username end))
               order by e.created_at)
        from public.expenses e
        join public.expense_categories c on c.id = e.category_id
        left join public.profiles pr on pr.id = e.created_by
        where e.tenant_id = _tenant and e.business_date = _d and e.voided_at is null
      ), '[]'::jsonb)
    ),
    'cash_book', jsonb_build_object(
      'cash_sales_cents', _cash_in,
      'cash_refunds_cents', _cash_ref,
      'cash_expenses_cents', _cash_exp,
      'expected_cash_cents', _expected_cash,
      'online_sales_cents', _online_in,
      'online_refunds_cents', _online_ref,
      'online_expenses_cents', _online_exp,
      'expected_online_cents', _expected_online,
      'closed', _close.tenant_id is not null,
      'counted_cash_cents', _close.cash_counted_cents,
      'counted_online_cents', _close.online_counted_cents,
      'cash_variance_cents', case when _close.tenant_id is not null
                                  then _close.cash_counted_cents - _expected_cash end,
      'online_variance_cents', case when _close.online_counted_cents is not null
                                    then _close.online_counted_cents - _expected_online end,
      'note', _close.note,
      'closed_at', _close.closed_at,
      'closed_by', (select coalesce(pr.full_name, '@' || pr.username)
                    from public.profiles pr where pr.id = _close.closed_by)
    )
  );
end $$;

revoke execute on function public.daily_report_build(uuid, date) from public, anon, authenticated;
