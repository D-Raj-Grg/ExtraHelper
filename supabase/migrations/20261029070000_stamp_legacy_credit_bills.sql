-- Bills left on credit before bills.credit_left_at existed carry no stamp, so
-- the POS board still read them as "Bill unpaid" on a held table. These four
-- were confirmed by the tenant as left on credit; stamp them, then free any
-- table whose only remaining orders are stamped credit bills.
-- Tenant 2fd2168a (The Sekuwa Station) only.

update public.bills
   set credit_left_at = coalesce(credit_left_at, updated_at)
 where tenant_id = '2fd2168a-0728-456a-8308-202134599864'
   and id in (
     '86c29818-5b3e-49a6-aade-b2540c40cef7',
     'b293cff3-9d23-4145-b920-cf5219dd35fc',
     '2785e61e-c289-4e86-ad3d-28e5982ff806',
     '69387ea9-bd8a-4f62-98e9-253a167a673f'
   )
   and status in ('open', 'partial')
   and cancelled_at is null;

update public.restaurant_tables t
   set state = 'free', current_order_id = null
 where t.tenant_id = '2fd2168a-0728-456a-8308-202134599864'
   and t.state in ('occupied', 'bill_requested')
   and exists (
     select 1 from public.orders o
       join public.bills b on b.id = o.bill_id
      where o.table_id = t.id and b.credit_left_at is not null)
   and not exists (
     select 1 from public.orders o
       left join public.bills b on b.id = o.bill_id
      where o.table_id = t.id
        and o.status not in ('closed', 'cancelled')
        and b.credit_left_at is null);
