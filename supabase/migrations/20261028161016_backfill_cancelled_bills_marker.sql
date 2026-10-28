-- Bills voided by a cancel before bills.cancelled_at existed (20261028160710):
-- void, never refunded, and their order is cancelled. Without the marker the
-- "cancelled bills stay cancelled" trigger would not protect them.
--
-- Two other pre-existing void bills have neither a refund nor a cancelled
-- order, so their origin is unknown; they are left unmarked on purpose.
update public.bills b
set cancelled_at = coalesce(b.updated_at, now())
where b.status = 'void'
  and b.cancelled_at is null
  and not exists (select 1 from public.payments p where p.bill_id = b.id and p.status = 'refunded')
  and exists (select 1 from public.orders o where o.bill_id = b.id and o.status = 'cancelled');
