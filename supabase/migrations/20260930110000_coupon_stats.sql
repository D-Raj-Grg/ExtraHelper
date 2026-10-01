-- Headline numbers for the Coupons page: how many coupons are in each state,
-- counting campaign coupons and flyer-run codes together, plus what the whole
-- lot has given away. The state order is `couponStatus()` in
-- lib/coupon-constants.ts, character for character: paused, used up, expired,
-- scheduled, active. Change one, change the other.
create or replace function public.coupon_stats(_tenant uuid)
returns table (
  active bigint, scheduled bigint, expired bigint, used_up bigint, paused bigint,
  redemptions bigint, discount_given_cents bigint
)
language sql stable security definer set search_path = public
as $$
  with s as (
    select case
             when not c.is_active then 'paused'
             when c.usage_limit is not null and c.used_count >= c.usage_limit then 'used_up'
             when c.valid_to is not null and c.valid_to <= now() then 'expired'
             when c.valid_from is not null and c.valid_from > now() then 'scheduled'
             else 'active'
           end as st
    from public.coupons c
    where c.tenant_id = _tenant
  ), d as (
    select count(*) as n,
           coalesce(sum(public._coupon_discount_cents(x.type, x.value, b.subtotal_cents, b.subtotal_cents)), 0)::bigint as cents
    from public.discounts x
    join public.bills b on b.id = x.bill_id
    where x.tenant_id = _tenant and x.coupon_id is not null
  )
  select count(*) filter (where s.st = 'active'),
         count(*) filter (where s.st = 'scheduled'),
         count(*) filter (where s.st = 'expired'),
         count(*) filter (where s.st = 'used_up'),
         count(*) filter (where s.st = 'paused'),
         case when public.has_permission(_tenant, 'coupons.view') then (select n from d) else 0 end,
         case when public.has_permission(_tenant, 'coupons.view') then (select cents from d) else 0 end
  from s
  where public.has_permission(_tenant, 'coupons.view');
$$;

revoke execute on function public.coupon_stats(uuid) from public, anon;
grant execute on function public.coupon_stats(uuid) to authenticated;
