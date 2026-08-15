-- Split "bill" into two documents, part 1 of 2: the enum value.
--
-- Until now one `bill` document covered both halves of the counter ritual: the
-- estimate the guest reads before paying, and the receipt that comes out once
-- the money has moved. One printer_documents row therefore switched both on,
-- and a restaurant that wants the bill on paper but no receipt after a card
-- tap had no way to say so.
--
-- `receipt` is that second half. Its content is unchanged — the renderer
-- already decides "tax invoice" from `bills.status`, not from the doc — so this
-- is purely about routing and about whether the settle trigger fires at all.
--
-- Split from part 2 because `alter type ... add value` cannot be consumed by
-- anything in the same transaction that adds it.

alter type public.print_doc add value if not exists 'receipt';
