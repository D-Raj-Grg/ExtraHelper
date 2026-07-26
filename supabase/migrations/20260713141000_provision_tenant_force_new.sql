-- Phase 3: allow one user to create/own multiple restaurants. Add _force_new:
-- when true, skip the "user already has a tenant → return existing" guard.
-- Drop the 3-arg version so all calls resolve to the new 4-arg (default) one.
drop function if exists public.provision_tenant(text, text, text);

create or replace function public.provision_tenant(
  _name text,
  _currency text default 'USD',
  _timezone text default 'UTC',
  _force_new boolean default false
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _uid      uuid := auth.uid();
  _existing uuid;
  _tenant   uuid;
  _base     text;
  _slug     text;
begin
  if _uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(trim(_name), '') = '' then
    raise exception 'restaurant name is required' using errcode = '22023';
  end if;

  -- First-run (idempotent, double-submit-safe). "Add restaurant" passes force_new.
  if not _force_new then
    select tenant_id into _existing
    from public.user_tenants where user_id = _uid limit 1;
    if _existing is not null then
      return _existing;
    end if;
  end if;

  _base := nullif(trim(both '-' from regexp_replace(lower(_name), '[^a-z0-9]+', '-', 'g')), '');
  _base := coalesce(_base, 'restaurant');
  _slug := _base;
  while exists (select 1 from public.tenants where slug = _slug) loop
    _slug := _base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  end loop;

  insert into public.tenants (name, slug, status)
  values (trim(_name), _slug, 'trial')
  returning id into _tenant;

  insert into public.tenant_settings (tenant_id, currency, timezone)
  values (_tenant, coalesce(nullif(trim(_currency), ''), 'USD'),
                   coalesce(nullif(trim(_timezone), ''), 'UTC'));

  insert into public.branches (tenant_id, name, is_default)
  values (_tenant, 'Main', true);

  insert into public.user_tenants (user_id, tenant_id, role)
  values (_uid, _tenant, 'owner');

  perform public.seed_system_roles(_tenant);
  update public.user_tenants
  set role_id = (select id from public.roles where tenant_id = _tenant and is_system and base_role = 'owner' limit 1)
  where user_id = _uid and tenant_id = _tenant;

  return _tenant;
end $function$;

revoke execute on function public.provision_tenant(text, text, text, boolean) from public, anon;
grant execute on function public.provision_tenant(text, text, text, boolean) to authenticated;
