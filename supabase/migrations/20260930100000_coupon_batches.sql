-- ============================================================================
-- Coupon batches: hundreds of unique, single-use codes for a print run.
--
-- A printed flyer carries its own code, so one flyer can be redeemed once and
-- the owner can see how many of a run came back. `upsert_coupon` makes one
-- coupon at a time and its generated code has about 65k possibilities, which
-- collides long before 500 — so a batch gets its own RPC and a wider code.
--
-- Batch coupons are ordinary rows in `coupons` (so `_coupon_lookup`,
-- `apply_coupon` and the guest preview treat them like any other) with
-- `usage_limit = 1` and a `batch_id`. `list_coupons` hides them: 500 rows would
-- bury the campaigns on both the web board and the mobile Coupons screen,
-- neither of which needs to change.
-- ============================================================================

create table if not exists public.coupon_batches (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  type        public.discount_type not null,
  value       numeric(10,2) not null,
  valid_from  timestamptz,
  valid_to    timestamptz,
  count       integer not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_coupon_batches_tenant on public.coupon_batches(tenant_id, created_at desc);

alter table public.coupon_batches enable row level security;
drop policy if exists coupon_batches_select on public.coupon_batches;
create policy coupon_batches_select on public.coupon_batches
  for select to authenticated
  using (
    (tenant_id in (select public.current_tenant_ids())
     and public.has_permission(tenant_id, 'coupons.view'))
    or public.is_platform_admin()
  );
revoke insert, update, delete, truncate, references, trigger on public.coupon_batches from anon, authenticated;

alter table public.coupons
  add column if not exists batch_id uuid references public.coupon_batches(id) on delete cascade;
create index if not exists idx_coupons_batch on public.coupons(batch_id) where batch_id is not null;

-- ---------------------------------------------------------------------------
-- create_coupon_batch: `_count` unique single-use codes, `PREFIX-XXXXXX`.
-- The six characters come from an alphabet with no 0/O/1/I/L (printed codes get
-- read aloud and typed), about 887M combinations. Bytes come from
-- gen_random_uuid(), which is a CSPRNG and, unlike gen_random_bytes, is a core
-- function that search_path = public can reach.
-- ---------------------------------------------------------------------------
create or replace function public.create_coupon_batch(
  _tenant uuid, _name text, _count integer, _prefix text,
  _type public.discount_type, _value numeric,
  _valid_from timestamptz, _valid_to timestamptz,
  _min_subtotal_cents integer, _once_per_customer boolean, _order_types public.order_type[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  _pfx text := upper(trim(coalesce(_prefix, '')));
  _batch uuid; _have integer := 0; _rounds integer := 0; _added integer;
begin
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(trim(_name), '') = '' then raise exception 'Give the batch a name' using errcode = '22023'; end if;
  if _count is null or _count < 1 or _count > 1000 then
    raise exception 'A batch is 1 to 1000 codes' using errcode = '22023';
  end if;
  if _pfx !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'The prefix is 2 to 8 letters or digits' using errcode = '22023';
  end if;
  if _value is null or _value <= 0 then raise exception 'The discount must be above zero' using errcode = '22023'; end if;
  if _type = 'percent' and _value > 100 then raise exception 'A discount can''t be more than 100%%' using errcode = '22023'; end if;
  if coalesce(_min_subtotal_cents, 0) < 0 then raise exception 'Minimum order can''t be negative' using errcode = '22023'; end if;
  if _valid_from is not null and _valid_to is not null and _valid_to <= _valid_from then
    raise exception 'The coupon must end after it starts' using errcode = '22023';
  end if;
  if _order_types is not null and cardinality(_order_types) = 0 then _order_types := null; end if;

  insert into public.coupon_batches (tenant_id, name, type, value, valid_from, valid_to, count, created_by)
  values (_tenant, trim(_name), _type, _value, _valid_from, _valid_to, _count, auth.uid())
  returning id into _batch;

  -- Top up until the batch is full: a collision (with another batch or inside
  -- this one) just drops that row and the next round replaces it.
  while _have < _count loop
    _rounds := _rounds + 1;
    if _rounds > 20 then raise exception 'Couldn''t generate enough unique codes; try a different prefix' using errcode = '22023'; end if;

    -- `|| g::text` ties the random bytes to the row. Without a reference to the
    -- outer row the lateral subquery is evaluated once and every code is equal.
    insert into public.coupons (tenant_id, code, name, type, value, is_active, valid_from, valid_to,
                                usage_limit, min_subtotal_cents, once_per_customer, order_types, created_by, batch_id)
    select _tenant,
           _pfx || '-' || (
             select string_agg(substr(_alphabet, 1 + (get_byte(r.b, i) % length(_alphabet)), 1), '' order by i)
             from generate_series(0, 5) i
           ),
           trim(_name), _type, _value, true, _valid_from, _valid_to,
           1, coalesce(_min_subtotal_cents, 0), coalesce(_once_per_customer, false), _order_types, auth.uid(), _batch
    from generate_series(1, _count - _have) g
    cross join lateral (select decode(md5(gen_random_uuid()::text || g::text), 'hex') as b) r
    on conflict (tenant_id, code) do nothing;
    get diagnostics _added = row_count;
    _have := _have + _added;
  end loop;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'coupon_batch_created', 'coupon_batch', _batch,
          jsonb_build_object('name', trim(_name), 'count', _count, 'prefix', _pfx, 'type', _type, 'value', _value,
                             'valid_from', _valid_from, 'valid_to', _valid_to));
  return _batch;
end $$;

-- One row per batch with how many came back.
create or replace function public.list_coupon_batches(_tenant uuid)
returns table (
  id uuid, name text, type public.discount_type, value numeric,
  valid_from timestamptz, valid_to timestamptz, created_at timestamptz,
  issued bigint, redeemed bigint, active bigint
)
language sql stable security definer set search_path = public
as $$
  select b.id, b.name, b.type, b.value, b.valid_from, b.valid_to, b.created_at,
         count(c.id) as issued,
         count(c.id) filter (where c.used_count > 0) as redeemed,
         count(c.id) filter (where c.is_active) as active
  from public.coupon_batches b
  left join public.coupons c on c.batch_id = b.id
  where b.tenant_id = _tenant and public.has_permission(_tenant, 'coupons.view')
  group by b.id
  order by b.created_at desc;
$$;

-- The codes of one batch, for (re)printing and the CSV.
create or replace function public.get_batch_codes(_batch uuid)
returns table (code text, redeemed boolean, is_active boolean)
language plpgsql stable security definer set search_path = public
as $$
declare _tenant uuid;
begin
  select tenant_id into _tenant from public.coupon_batches where id = _batch;
  if _tenant is null then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.view') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query
    select c.code, c.used_count > 0, c.is_active
    from public.coupons c where c.batch_id = _batch
    order by c.code;
end $$;

-- Pause or resume a whole run, e.g. when a stack of flyers is lost.
create or replace function public.set_batch_active(_batch uuid, _active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _name text;
begin
  select tenant_id, name into _tenant, _name from public.coupon_batches where id = _batch;
  if _tenant is null then raise exception 'batch not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_tenant, 'coupons.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.coupons set is_active = coalesce(_active, true) where batch_id = _batch;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_tenant, auth.uid(), 'coupon_batch_active', 'coupon_batch', _batch,
          jsonb_build_object('name', _name, 'active', coalesce(_active, true)));
end $$;

-- list_coupons: same signature and columns, minus batch coupons.
create or replace function public.list_coupons(_tenant uuid)
returns table (
  id uuid, code text, name text, type public.discount_type, value numeric, is_active boolean,
  valid_from timestamptz, valid_to timestamptz, usage_limit integer, used_count integer,
  min_subtotal_cents integer, once_per_customer boolean, order_types public.order_type[],
  created_at timestamptz, redemptions bigint, discount_given_cents bigint, last_redeemed_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.code, c.name, c.type, c.value, c.is_active, c.valid_from, c.valid_to, c.usage_limit, c.used_count,
         c.min_subtotal_cents, c.once_per_customer, c.order_types, c.created_at,
         count(d.id) as redemptions,
         coalesce(sum(public._coupon_discount_cents(d.type, d.value, b.subtotal_cents, b.subtotal_cents)), 0)::bigint as discount_given_cents,
         max(d.created_at) as last_redeemed_at
  from public.coupons c
  left join public.discounts d on d.coupon_id = c.id
  left join public.bills b on b.id = d.bill_id
  where c.tenant_id = _tenant and c.batch_id is null and public.has_permission(_tenant, 'coupons.view')
  group by c.id
  order by c.is_active desc, c.created_at desc;
$$;

revoke execute on function public.create_coupon_batch(uuid, text, integer, text, public.discount_type, numeric, timestamptz, timestamptz, integer, boolean, public.order_type[]) from public, anon;
revoke execute on function public.list_coupon_batches(uuid) from public, anon;
revoke execute on function public.get_batch_codes(uuid) from public, anon;
revoke execute on function public.set_batch_active(uuid, boolean) from public, anon;
revoke execute on function public.list_coupons(uuid) from public, anon;
grant execute on function public.create_coupon_batch(uuid, text, integer, text, public.discount_type, numeric, timestamptz, timestamptz, integer, boolean, public.order_type[]) to authenticated;
grant execute on function public.list_coupon_batches(uuid) to authenticated;
grant execute on function public.get_batch_codes(uuid) to authenticated;
grant execute on function public.set_batch_active(uuid, boolean) to authenticated;
grant execute on function public.list_coupons(uuid) to authenticated;
