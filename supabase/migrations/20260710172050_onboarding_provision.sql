-- ============================================================================
-- Tenant onboarding provisioning.
-- Authenticated users can't INSERT tenants directly (RLS: platform-admin only),
-- so onboarding goes through this SECURITY DEFINER function. It atomically
-- creates the tenant + settings + default branch + owner membership for the
-- calling user, and is idempotent (returns the existing tenant if the user is
-- already a member of one).
-- ============================================================================

create or replace function public.provision_tenant(
  _name     text,
  _currency text default 'USD',
  _timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- Idempotent: already onboarded → return the user's tenant.
  select tenant_id into _existing
  from public.user_tenants where user_id = _uid limit 1;
  if _existing is not null then
    return _existing;
  end if;

  -- Slug from name, uniqueness enforced with a short random suffix on collision.
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

  return _tenant;
end $$;

revoke execute on function public.provision_tenant(text, text, text) from anon;
grant execute on function public.provision_tenant(text, text, text) to authenticated;
