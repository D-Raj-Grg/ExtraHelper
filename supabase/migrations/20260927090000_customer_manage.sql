-- ============================================================================
-- Customers: edit, delete, merge — and one idea of "the same phone".
--
-- Until now the Loyalty page listed customers with no way to change one, and
-- the only policy on `customers` (`tenant_all`, FOR ALL) let any signed-in
-- staff member update or delete a row straight through the API, with no role
-- check and no audit entry. Meanwhile every find-or-create path matched the
-- phone *as typed*, so "+9779767288510" and "9767288510" became two people.
--
-- This migration:
--   1. adds `tenant_settings.phone_country_code` (region-configurable, rule #2)
--      and `normalize_phone(tenant, text)`, which reduces a phone to its
--      national digits;
--   2. stores that on `customers.phone_norm` via trigger, backfills it, and
--      re-normalises a tenant's customers when the country code changes;
--   3. routes every find-or-create (POS, bill, storefront, reservations, and
--      the web's order-detail action) through one `customer_for_phone`;
--   4. adds `update_customer`, `delete_customer`, `merge_customers` — all
--      gated on the existing `loyalty.edit` permission, all written to
--      `audit_logs`;
--   5. replaces `tenant_all` on `customers` with select + insert only, so a
--      customer can change or disappear *only* through those functions.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Phone country code, per tenant
-- ---------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists phone_country_code text;

alter table public.tenant_settings
  drop constraint if exists tenant_settings_phone_country_code_check;
alter table public.tenant_settings
  add constraint tenant_settings_phone_country_code_check
  check (phone_country_code is null or phone_country_code ~ '^[0-9]{1,4}$');

comment on column public.tenant_settings.phone_country_code is
  'Dialling code without the +, e.g. 977. Stripped from customer phones on lookup so a number typed with or without it is one customer. Null = compare digits as typed.';

-- A starting point for tenants that already exist, from the currency they
-- picked. A default only — Settings → General lets the owner change it, and
-- currencies shared by several countries are left null.
update public.tenant_settings
   set phone_country_code = case currency
         when 'NPR' then '977'
         when 'INR' then '91'
         when 'GBP' then '44'
         when 'AED' then '971'
         when 'SGD' then '65'
         when 'AUD' then '61'
         when 'JPY' then '81'
         else null
       end
 where phone_country_code is null;

-- ---------------------------------------------------------------------------
-- 2. normalize_phone + customers.phone_norm
-- ---------------------------------------------------------------------------

-- Digits only; "00" international prefix and the tenant's own country code
-- dropped; one trunk "0" dropped when a country code is set. Null in, null
-- out. Security definer so the trigger sees tenant_settings whoever fires it.
create or replace function public.normalize_phone(_tenant uuid, _phone text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _d text; _cc text;
begin
  _d := regexp_replace(coalesce(_phone, ''), '[^0-9]', '', 'g');
  if _d = '' then return null; end if;
  if _d like '00%' then _d := substr(_d, 3); end if;

  select phone_country_code into _cc from public.tenant_settings where tenant_id = _tenant;
  if _cc is not null then
    if _d like _cc || '%' and length(_d) - length(_cc) >= 7 then
      _d := substr(_d, length(_cc) + 1);
    end if;
    if _d like '0%' and length(_d) >= 9 then
      _d := substr(_d, 2);
    end if;
  end if;
  return nullif(_d, '');
end $$;

revoke execute on function public.normalize_phone(uuid, text) from public, anon;
grant  execute on function public.normalize_phone(uuid, text) to authenticated;

alter table public.customers
  add column if not exists phone_norm text;

comment on column public.customers.phone_norm is
  'normalize_phone(tenant_id, phone), kept by trigger. The column every phone lookup matches on.';

create or replace function public.customers_set_phone_norm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.phone      := nullif(btrim(new.phone), '');
  new.email      := nullif(btrim(new.email), '');
  new.phone_norm := public.normalize_phone(new.tenant_id, new.phone);
  return new;
end $$;

drop trigger if exists trg_customers_phone_norm on public.customers;
create trigger trg_customers_phone_norm
  before insert or update of phone, tenant_id on public.customers
  for each row execute function public.customers_set_phone_norm();

update public.customers
   set phone_norm = public.normalize_phone(tenant_id, phone);

create index if not exists idx_customers_tenant_phone_norm
  on public.customers (tenant_id, phone_norm);

-- Changing the country code changes what every stored phone reduces to.
create or replace function public.tenant_settings_renormalize_phones()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.phone_country_code is distinct from old.phone_country_code then
    update public.customers
       set phone_norm = public.normalize_phone(tenant_id, phone)
     where tenant_id = new.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_tenant_settings_renormalize_phones on public.tenant_settings;
create trigger trg_tenant_settings_renormalize_phones
  after update of phone_country_code on public.tenant_settings
  for each row execute function public.tenant_settings_renormalize_phones();

-- ---------------------------------------------------------------------------
-- 3. One find-or-create
-- ---------------------------------------------------------------------------

-- Internal: no auth check, so it is callable only from inside the security
-- definer functions below (EXECUTE is revoked from every API role).
create or replace function public.customer_for_phone(_tenant uuid, _name text, _phone text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _norm text; _cust uuid;
begin
  _name  := nullif(btrim(_name), '');
  _phone := nullif(btrim(_phone), '');
  _norm  := public.normalize_phone(_tenant, _phone);

  if _norm is not null then
    select id into _cust from public.customers
     where tenant_id = _tenant and phone_norm = _norm
     order by created_at
     limit 1;
  end if;

  if _cust is not null then
    -- A placeholder learns the real name; a real name is never clobbered.
    if _name is not null then
      update public.customers set name = _name
       where id = _cust and (name is null or name = 'Guest');
    end if;
    return _cust;
  end if;

  insert into public.customers (tenant_id, name, phone)
  values (_tenant, coalesce(_name, 'Guest'), _phone)
  returning id into _cust;
  return _cust;
end $$;

revoke execute on function public.customer_for_phone(uuid, text, text) from public, anon, authenticated;

-- The API-facing wrapper the web's order-detail action calls: any active
-- member of the tenant may attach a customer to an order, as before.
create or replace function public.find_or_create_customer(_tenant uuid, _name text, _phone text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.user_tenants
     where user_id = auth.uid() and tenant_id = _tenant and status = 'active'
  ) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if nullif(btrim(_name), '') is null and nullif(btrim(_phone), '') is null then
    raise exception 'name or phone required' using errcode = '22023';
  end if;
  return public.customer_for_phone(_tenant, _name, _phone);
end $$;

revoke execute on function public.find_or_create_customer(uuid, text, text) from public, anon;
grant  execute on function public.find_or_create_customer(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Every find-or-create path now goes through customer_for_phone. The four
-- bodies below are the live definitions with only the lookup swapped.
-- ---------------------------------------------------------------------------

create or replace function public.place_staff_order(
  _tenant           uuid,
  _idempotency_key  text,
  _table_id         uuid,
  _order_type       public.order_type,
  _items            jsonb,
  _guests           integer default null,
  _waiter           uuid    default null,
  _customer         uuid    default null,
  _customer_name    text    default null,
  _customer_phone   text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _branch uuid;
  _order  uuid;
  _line   jsonb;
  _item   record;
  _v      record;
  _count  integer := 0;
  _oi     uuid;
  _name   text;
  _price  integer;
  _qty    integer;
  _notes  text;
  _course integer;
  _seat   integer;
  _var    uuid;
  _modids uuid[];
  _mprice integer;
  _cust   uuid;
  _cname  text;
  _cphone text;
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager', 'cashier', 'waiter') then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if coalesce(trim(_idempotency_key), '') = '' then
    raise exception 'idempotency key required' using errcode = '22023';
  end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode = '22023';
  end if;

  -- POS produces dine-in and pickup only. 'qr' has its own public RPC and
  -- 'delivery' is unreachable from this surface; accepting them here would
  -- silently create orders no POS screen knows how to finish.
  if _order_type not in ('dine_in', 'pickup') then
    raise exception 'POS places dine-in or pickup orders only' using errcode = '22023';
  end if;
  -- A table implies dine-in. Refuse the contradiction rather than pick a winner.
  if _table_id is not null and _order_type <> 'dine_in' then
    raise exception 'a table implies a dine-in order' using errcode = '22023';
  end if;

  -- SECURITY DEFINER bypasses RLS, so every id from the client is checked
  -- against _tenant explicitly. An unchecked id here is a cross-tenant write.
  if _table_id is not null then
    select branch_id into _branch from public.restaurant_tables
    where id = _table_id and tenant_id = _tenant;
    if not found then
      raise exception 'table does not belong to this tenant' using errcode = '22023';
    end if;
  end if;

  -- Replay fast path: a committed order must not be mutated, and must not
  -- leave a stray customer row behind. Return before any write. The
  -- on-conflict below still guards the genuine concurrent-submit race.
  select id into _order from public.orders
  where tenant_id = _tenant and idempotency_key = _idempotency_key;
  if _order is not null then
    return _order;
  end if;

  -- auth.uid() survives SECURITY DEFINER — it reads a JWT GUC, not the role.
  _waiter := coalesce(_waiter, auth.uid());
  if _waiter is not null and not exists (
    select 1 from public.user_tenants
    where user_id = _waiter and tenant_id = _tenant and status = 'active'
  ) then
    raise exception 'staff member is not on this tenant' using errcode = '22023';
  end if;

  if _guests is not null and (_guests < 1 or _guests > 200) then
    raise exception 'guests out of range' using errcode = '22023';
  end if;

  -- Customer: an explicit id must be ours; otherwise find-or-create by phone
  -- through customer_for_phone, the one place that knows what "the same
  -- customer" means (normalised phone, 20260927090000_customer_manage.sql).
  _cname  := nullif(trim(_customer_name), '');
  _cphone := nullif(trim(_customer_phone), '');
  if _customer is not null then
    select id into _cust from public.customers
    where id = _customer and tenant_id = _tenant;
    if _cust is null then
      raise exception 'customer does not belong to this tenant' using errcode = '22023';
    end if;
  elsif _cname is not null or _cphone is not null then
    _cust := public.customer_for_phone(_tenant, _cname, _cphone);
  end if;

  insert into public.orders (
    tenant_id, branch_id, table_id, order_type, status, idempotency_key,
    guests, waiter_id, customer_id
  )
  values (
    _tenant, _branch, _table_id, _order_type, 'draft', _idempotency_key,
    _guests, _waiter, _cust
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into _order;

  if _order is null then
    select id into _order from public.orders
    where tenant_id = _tenant and idempotency_key = _idempotency_key;
    return _order;
  end if;

  for _line in select * from jsonb_array_elements(_items)
  loop
    _qty    := greatest(1, least(99, coalesce((_line->>'qty')::int, 1)));
    _notes  := nullif(trim(_line->>'notes'), '');
    _course := nullif(_line->>'course', '')::int;
    _seat   := nullif(_line->>'seat', '')::int;
    if _course is not null then _course := greatest(1, least(99, _course)); end if;
    if _seat   is not null then _seat   := greatest(1, least(99, _seat));   end if;

    -- Custom (off-menu) line. item_id stays null so it can never impersonate a
    -- menu item's price, and fire_order's coalesce(station_id, nil) grouping
    -- routes it onto the expo ticket rather than dropping it.
    _name := nullif(trim(coalesce(_line->>'custom_name', '')), '');
    if _name is not null then
      -- The one client-supplied price in the system: there is no server-side
      -- truth for "birthday cake plating charge". Clamped, and staff-only.
      _price := coalesce((_line->>'unit_price_cents')::int, 0);
      if _price < 0 or _price > 10000000 then
        raise exception 'custom item price out of range' using errcode = '22023';
      end if;
      insert into public.order_items (
        tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents,
        notes, course, seat, status
      )
      values (_tenant, _order, null, _name, _qty, _price, _notes, _course, _seat, 'draft')
      returning id into _oi;
      -- Rule #5: a hand-typed price is a price change → audited. Mirrors the
      -- audit addCustomItem writes for the amend path.
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
      values (_tenant, auth.uid(), 'custom_price', 'order_item', _oi,
              jsonb_build_object('name', _name, 'unit_price_cents', _price,
                                 'qty', _qty, 'order_id', _order, 'source', 'place_staff_order'));
      _count := _count + 1;
      continue;
    end if;

    select id, name, base_price_cents into _item
    from public.menu_items
    where id = nullif(_line->>'item_id', '')::uuid and tenant_id = _tenant
      and is_active and not is_86;
    -- Skip, don't abort: an item 86'd during an offline outage must not reject
    -- the whole queued order. The UI reopens against the real server rows after
    -- create, so a dropped line is visible rather than assumed.
    if _item.id is null then continue; end if;

    _price := _item.base_price_cents;
    _name  := _item.name;
    _var   := nullif(_line->>'variant_id', '')::uuid;

    if _var is not null then
      select name, price_delta_cents into _v
      from public.item_variants
      where id = _var and item_id = _item.id and tenant_id = _tenant;
      if not found then
        raise exception 'variant not found' using errcode = '22023';
      end if;
      _price := _price + _v.price_delta_cents;
      _name  := _item.name || ' (' || _v.name || ')';
    end if;

    if jsonb_typeof(_line->'modifier_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into _modids
      from jsonb_array_elements_text(_line->'modifier_ids') x;
    else
      _modids := '{}'::uuid[];
    end if;

    -- Every requested modifier must be linked to THIS item via item_modifiers,
    -- not merely owned by the tenant — otherwise "Extra cheese" prices onto a
    -- beer. Reject the whole line rather than silently drop the stray add-on, so
    -- the till total the guest saw and the kitchen ticket can't disagree.
    if cardinality(_modids) > 0 then
      if (
        select count(*) from public.item_modifiers im
        where im.tenant_id = _tenant and im.item_id = _item.id
          and im.modifier_id = any(_modids)
      ) <> cardinality(_modids) then
        raise exception 'modifier not available for this item' using errcode = '22023';
      end if;
    end if;

    -- Trusted prices, always re-fetched. The client's numbers are for its own
    -- running total and never reach this table.
    select coalesce(sum(price_cents), 0) into _mprice
    from public.modifiers where tenant_id = _tenant and id = any(_modids);
    _price := _price + _mprice;

    insert into public.order_items (
      tenant_id, order_id, item_id, variant_id, name_snapshot, qty,
      unit_price_cents, notes, course, seat, status
    )
    values (
      _tenant, _order, _item.id, _var, _name, _qty,
      _price, _notes, _course, _seat, 'draft'
    )
    returning id into _oi;

    insert into public.order_item_modifiers (
      tenant_id, order_item_id, modifier_id, name_snapshot, qty, price_cents
    )
    select _tenant, _oi, m.id, m.name, 1, m.price_cents
    from public.modifiers m
    where m.tenant_id = _tenant and m.id = any(_modids);

    _count := _count + 1;
  end loop;

  if _count = 0 then
    raise exception 'no valid items' using errcode = '22023';
  end if;

  if _table_id is not null then
    update public.restaurant_tables set state = 'occupied'
    where id = _table_id and tenant_id = _tenant and state = 'free';
  end if;

  return _order;
end $$;

create or replace function public.attach_bill_customer(_bill_id uuid, _name text, _phone text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _order uuid; _cust uuid; _existing uuid;
begin
  select tenant_id into _tenant from public.bills where id = _bill_id;
  if _tenant is null then raise exception 'bill not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = _tenant) then
    raise exception 'not authorized for this tenant' using errcode = '42501';
  end if;
  if not public.has_permission(_tenant, 'payment.take') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select id, customer_id into _order, _existing
  from public.orders where bill_id = _bill_id and tenant_id = _tenant limit 1;
  if _order is null then raise exception 'no order for this bill' using errcode = 'P0002'; end if;

  -- Slot already filled (e.g. POS set it at order create): don't reassign.
  if _existing is not null then
    return _existing;
  end if;

  _name := nullif(trim(_name), '');
  _phone := nullif(trim(_phone), '');
  if _name is null and _phone is null then
    raise exception 'name or phone required' using errcode = '22023';
  end if;

  _cust := public.customer_for_phone(_tenant, _name, _phone);

  update public.orders set customer_id = _cust where id = _order;
  return _cust;
end $$;

create or replace function public.place_online_order(
  _slug text, _items jsonb, _fulfillment text,
  _name text, _phone text, _address jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _tenant uuid; _cust uuid; _order uuid; _online uuid;
  _fee_units numeric; _fee_cents integer := 0;
  _line jsonb; _item record; _count integer := 0;
  _ftype public.order_type;
begin
  select id into _tenant from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then raise exception 'store not found' using errcode='P0002'; end if;
  if _fulfillment not in ('delivery','pickup') then
    raise exception 'invalid fulfillment' using errcode='22023';
  end if;
  if _items is null or jsonb_array_length(_items) = 0 then
    raise exception 'no items' using errcode='22023';
  end if;
  _ftype := _fulfillment::public.order_type;

  select coalesce((order_type_fees->>_fulfillment)::numeric, 0) into _fee_units
  from public.tenant_settings where tenant_id = _tenant;
  _fee_cents := round(coalesce(_fee_units,0) * 100);

  -- Find-or-create by normalised phone: a returning guest is one customer,
  -- not a new row per order.
  _cust := public.customer_for_phone(_tenant, _name, _phone);

  insert into public.orders (tenant_id, order_type, status, customer_id, placed_at)
  values (_tenant, _ftype, 'placed', _cust, now()) returning id into _order;

  for _line in select * from jsonb_array_elements(_items) loop
    select id, name, base_price_cents into _item from public.menu_items
    where id = (_line->>'item_id')::uuid and tenant_id = _tenant and is_active and not is_86;
    if _item.id is not null then
      insert into public.order_items (tenant_id, order_id, item_id, name_snapshot, qty, unit_price_cents, status)
      values (_tenant, _order, _item.id, _item.name,
              greatest(1, least(99, coalesce((_line->>'qty')::int,1))), _item.base_price_cents, 'placed');
      _count := _count + 1;
    end if;
  end loop;
  if _count = 0 then raise exception 'no valid items' using errcode='22023'; end if;

  insert into public.online_orders (tenant_id, order_id, customer_id, channel, fulfillment, address, fee_cents, status)
  values (_tenant, _order, _cust, 'web', _ftype, _address, _fee_cents, 'received')
  returning id into _online;

  return _online;
end $$;

create or replace function public.create_public_reservation(
  _slug text, _name text, _phone text, _party integer, _when timestamptz, _notes text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare _tenant uuid; _cust uuid; _resv uuid;
begin
  select id into _tenant from public.tenants where slug = _slug and status <> 'suspended';
  if _tenant is null then raise exception 'restaurant not found' using errcode='P0002'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'name required' using errcode='22023'; end if;
  if _party < 1 or _party > 50 then raise exception 'invalid party size' using errcode='22023'; end if;
  if _when is null or _when < now() then raise exception 'pick a future time' using errcode='22023'; end if;

  _cust := public.customer_for_phone(_tenant, _name, _phone);
  insert into public.reservations (tenant_id, customer_id, party_size, reserved_at, status, notes)
  values (_tenant, _cust, _party, _when, 'pending', nullif(trim(_notes),''))
  returning id into _resv;
  return _resv;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Edit, delete, merge — behind loyalty.edit, every one audited
-- ---------------------------------------------------------------------------

-- The key already existed ("Manage loyalty": owner + manager by default). It
-- now also covers the customer record itself, and the label says so.
update public.permissions
   set label = 'Edit, merge or delete customers; adjust points'
 where key = 'loyalty.edit';

create or replace function public.update_customer(
  _customer_id uuid,
  _name        text,
  _phone       text,
  _email       text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _c public.customers%rowtype; _norm text; _dup uuid;
begin
  select * into _c from public.customers where id = _customer_id;
  if _c.id is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_c.tenant_id, 'loyalty.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  _name  := nullif(btrim(_name), '');
  _phone := nullif(btrim(_phone), '');
  _email := nullif(lower(btrim(_email)), '');
  if _name is null and _phone is null then
    raise exception 'name or phone required' using errcode = '22023';
  end if;
  if length(_name) > 80 then
    raise exception 'name must be 80 characters or fewer' using errcode = '22023';
  end if;
  if length(_phone) > 30 then
    raise exception 'phone must be 30 characters or fewer' using errcode = '22023';
  end if;
  if _email is not null and (length(_email) > 120 or _email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'that does not look like an email address' using errcode = '22023';
  end if;

  -- Two rows with one phone is exactly what merge exists for; refuse to make
  -- another pair by hand.
  _norm := public.normalize_phone(_c.tenant_id, _phone);
  if _norm is not null then
    select id into _dup from public.customers
     where tenant_id = _c.tenant_id and phone_norm = _norm and id <> _c.id
     limit 1;
    if _dup is not null then
      raise exception 'another customer already has this phone — merge them instead'
        using errcode = '23505';
    end if;
  end if;

  update public.customers
     set name = _name, phone = _phone, email = _email
   where id = _c.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_c.tenant_id, auth.uid(), 'customer_update', 'customer', _c.id,
          jsonb_build_object(
            'before', jsonb_build_object('name', _c.name, 'phone', _c.phone, 'email', _c.email),
            'after',  jsonb_build_object('name', _name,   'phone', _phone,   'email', _email)));
end $$;

revoke execute on function public.update_customer(uuid, text, text, text) from public, anon;
grant  execute on function public.update_customer(uuid, text, text, text) to authenticated;

-- Deleting cascades the loyalty account and its history. Orders, bills,
-- reservations and feedback keep their money and dates and lose the name
-- (their FKs are ON DELETE SET NULL). The audit row keeps what was lost.
create or replace function public.delete_customer(_customer_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _c public.customers%rowtype; _orders integer; _points integer;
begin
  select * into _c from public.customers where id = _customer_id;
  if _c.id is null then raise exception 'customer not found' using errcode = 'P0002'; end if;
  if not public.has_permission(_c.tenant_id, 'loyalty.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select count(*) into _orders from public.orders where customer_id = _c.id;
  select coalesce(sum(points_balance), 0) into _points
    from public.loyalty_accounts where customer_id = _c.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_c.tenant_id, auth.uid(), 'customer_delete', 'customer', _c.id,
          jsonb_build_object('name', _c.name, 'phone', _c.phone, 'email', _c.email,
                             'orders', _orders, 'points_balance', _points));

  delete from public.customers where id = _c.id;
end $$;

revoke execute on function public.delete_customer(uuid) from public, anon;
grant  execute on function public.delete_customer(uuid) to authenticated;

-- Everything on `_drop` moves to `_keep`, then `_drop` goes: orders,
-- reservations, online orders, feedback, and the loyalty account (points
-- added, transactions re-parented, tier recomputed on the same thresholds as
-- loyalty_adjust). Blank fields on the keeper are filled from the other row.
create or replace function public.merge_customers(_keep_id uuid, _drop_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _keep public.customers%rowtype;
  _drop public.customers%rowtype;
  _keep_acct uuid; _drop_acct uuid; _drop_pts integer := 0; _new integer;
  _orders integer;
begin
  if _keep_id = _drop_id then
    raise exception 'pick two different customers' using errcode = '22023';
  end if;
  select * into _keep from public.customers where id = _keep_id;
  select * into _drop from public.customers where id = _drop_id;
  if _keep.id is null or _drop.id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if _keep.tenant_id <> _drop.tenant_id then
    raise exception 'customers belong to different tenants' using errcode = '22023';
  end if;
  if not public.has_permission(_keep.tenant_id, 'loyalty.edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  update public.orders        set customer_id = _keep.id where customer_id = _drop.id;
  get diagnostics _orders = row_count;
  update public.reservations  set customer_id = _keep.id where customer_id = _drop.id;
  update public.online_orders set customer_id = _keep.id where customer_id = _drop.id;
  update public.feedback      set customer_id = _keep.id where customer_id = _drop.id;

  select id, points_balance into _drop_acct, _drop_pts
    from public.loyalty_accounts where customer_id = _drop.id;
  if _drop_acct is not null then
    insert into public.loyalty_accounts (tenant_id, customer_id, points_balance)
    values (_keep.tenant_id, _keep.id, 0)
    on conflict (tenant_id, customer_id) do nothing;
    select id into _keep_acct from public.loyalty_accounts where customer_id = _keep.id;

    update public.loyalty_transactions
       set loyalty_account_id = _keep_acct
     where loyalty_account_id = _drop_acct;

    update public.loyalty_accounts
       set points_balance = points_balance + coalesce(_drop_pts, 0)
     where id = _keep_acct
     returning points_balance into _new;
    update public.loyalty_accounts
       set tier = case when _new >= 500 then 'gold' when _new >= 100 then 'silver' else 'bronze' end
     where id = _keep_acct;

    delete from public.loyalty_accounts where id = _drop_acct;
  end if;

  update public.customers
     set name         = coalesce(_keep.name, _drop.name),
         phone        = coalesce(_keep.phone, _drop.phone),
         email        = coalesce(_keep.email, _drop.email),
         auth_user_id = coalesce(_keep.auth_user_id, _drop.auth_user_id)
   where id = _keep.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (_keep.tenant_id, auth.uid(), 'customer_merge', 'customer', _keep.id,
          jsonb_build_object(
            'merged_from', _drop.id,
            'merged',      jsonb_build_object('name', _drop.name, 'phone', _drop.phone, 'email', _drop.email),
            'orders_moved', _orders,
            'points_moved', coalesce(_drop_pts, 0)));

  delete from public.customers where id = _drop.id;
end $$;

revoke execute on function public.merge_customers(uuid, uuid) from public, anon;
grant  execute on function public.merge_customers(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. customers: read and insert stay open to the tenant; change goes through
--    the functions above.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_all on public.customers;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

-- Insert stays: the POS attaches a walk-in by name + phone as the signed-in
-- user, and mobile does the same.
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check (tenant_id in (select public.current_tenant_ids()) or public.is_platform_admin());

revoke update, delete, truncate, references, trigger on public.customers from anon, authenticated;
revoke insert, select on public.customers from anon;
