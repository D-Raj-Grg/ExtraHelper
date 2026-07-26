-- Wave J: per-tenant payment gateway selection (rule #6 — pluggable, not hardcoded).
alter table public.tenant_settings
  add column if not exists payment_gateway text not null default 'sandbox';
