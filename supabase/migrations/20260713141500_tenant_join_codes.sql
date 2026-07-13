-- Phase 4: self-serve join via a shareable code. Redemption creates a PENDING
-- membership (owner approves via existing approve_member) — a leaked code can't
-- grant instant access.
create table if not exists public.tenant_join_codes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  code       text not null unique,
  base_role  public.app_role not null default 'waiter',
  role_id    uuid references public.roles(id) on delete set null,
  created_by uuid,
  expires_at timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_tenant_join_codes_tenant on public.tenant_join_codes(tenant_id);

alter table public.tenant_join_codes enable row level security;
drop policy if exists join_codes_manage on public.tenant_join_codes;
create policy join_codes_manage on public.tenant_join_codes
  for all to authenticated
  using (public.has_tenant_role(tenant_id, 'owner', 'manager') or public.is_platform_admin())
  with check (public.has_tenant_role(tenant_id, 'owner', 'manager') or public.is_platform_admin());

create or replace function public.create_join_code(_tenant uuid, _role_id uuid default null)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _code text; _base public.app_role := 'waiter';
begin
  if not public.has_tenant_role(_tenant, 'owner', 'manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _role_id is not null then
    select base_role into _base from public.roles where id = _role_id and tenant_id = _tenant;
    if _base is null then raise exception 'role not found' using errcode = 'P0002'; end if;
  end if;
  loop
    _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.tenant_join_codes where code = _code);
  end loop;
  insert into public.tenant_join_codes (tenant_id, code, base_role, role_id, created_by)
  values (_tenant, _code, _base, _role_id, auth.uid());
  return _code;
end $function$;

create or replace function public.redeem_join_code(_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _uid uuid := auth.uid(); _row record; _name text; _existing text;
begin
  if _uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into _row from public.tenant_join_codes
   where upper(code) = upper(trim(_code)) and is_active = true
     and (expires_at is null or expires_at > now());
  if _row.id is null then raise exception 'invalid or expired code' using errcode = '22023'; end if;

  select name into _name from public.tenants where id = _row.tenant_id;

  select status into _existing from public.user_tenants where user_id = _uid and tenant_id = _row.tenant_id;
  if _existing is not null then
    return jsonb_build_object('tenant_id', _row.tenant_id, 'name', _name, 'status', _existing, 'already', true);
  end if;

  insert into public.user_tenants (user_id, tenant_id, role, role_id, status)
  values (_uid, _row.tenant_id, _row.base_role, _row.role_id, 'pending')
  on conflict (user_id, tenant_id) do nothing;

  return jsonb_build_object('tenant_id', _row.tenant_id, 'name', _name, 'status', 'pending', 'already', false);
end $function$;

revoke execute on function public.create_join_code(uuid, uuid) from public, anon;
grant execute on function public.create_join_code(uuid, uuid) to authenticated;
revoke execute on function public.redeem_join_code(text) from public, anon;
grant execute on function public.redeem_join_code(text) to authenticated;
