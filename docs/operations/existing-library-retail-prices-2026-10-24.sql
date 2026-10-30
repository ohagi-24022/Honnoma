-- Exact-ISBN provider prices. Fill only missing retail prices, never purchase prices or names.
begin;
update public.books b set list_price=p.price,price_source='rakuten',price_fetched_at=p.checked_at
from (values
('9784063959048',471,'2026-10-24T14:56:12.929Z'::timestamptz),
('9784065101957',471,'2026-10-24T14:56:12.942Z'::timestamptz),
('9784065117897',484,'2026-10-24T14:56:13.533Z'::timestamptz),
('9784065122396',594,'2026-10-24T14:56:13.533Z'::timestamptz),
('9784065150764',495,'2026-10-24T14:56:14.045Z'::timestamptz),
('9784065156964',528,'2026-10-24T14:56:15.752Z'::timestamptz),
('9784065168912',715,'2026-10-24T14:56:16.310Z'::timestamptz),
('9784065171608',528,'2026-10-24T14:56:16.252Z'::timestamptz),
('9784065173084',495,'2026-10-24T14:56:16.808Z'::timestamptz),
('9784065178881',528,'2026-10-24T14:56:16.807Z'::timestamptz),
('9784065186862',528,'2026-10-24T14:56:17.318Z'::timestamptz),
('9784065193075',528,'2026-10-24T14:56:17.318Z'::timestamptz),
('9784065197400',715,'2026-10-24T14:56:19.469Z'::timestamptz),
('9784065203330',660,'2026-10-24T14:56:17.768Z'::timestamptz),
('9784065205990',528,'2026-10-24T14:56:21.729Z'::timestamptz),
('9784065216361',528,'2026-10-24T14:56:19.981Z'::timestamptz),
('9784065220320',715,'2026-10-24T14:56:22.338Z'::timestamptz),
('9784065228807',715,'2026-10-24T14:56:22.132Z'::timestamptz),
('9784065244685',528,'2026-10-24T14:56:22.790Z'::timestamptz),
('9784065265871',528,'2026-10-24T14:56:22.803Z'::timestamptz),
('9784065265949',715,'2026-10-24T14:56:23.487Z'::timestamptz),
('9784065272671',528,'2026-10-24T14:56:25.646Z'::timestamptz),
('9784065283806',528,'2026-10-24T14:56:26.126Z'::timestamptz),
('9784088804019',440,'2026-10-24T14:56:26.127Z'::timestamptz),
('9784088805399',770,'2026-10-24T14:56:26.636Z'::timestamptz),
('9784088805559',440,'2026-10-24T14:56:26.636Z'::timestamptz),
('9784088915463',660,'2026-10-24T14:56:27.150Z'::timestamptz),
('9784088918549',660,'2026-10-24T14:56:27.150Z'::timestamptz),
('9784088920313',660,'2026-10-24T14:56:27.559Z'::timestamptz),
('9784832246546',649,'2026-10-24T14:56:27.570Z'::timestamptz)
) p(isbn,price,checked_at)
where b.isbn=p.isbn and b.list_price is null;
select count(*) as missing_retail_prices from public.books where list_price is null;
commit;

-- Reuse existing exact-ISBN shared prices only for missing library retail values.
update public.books b set list_price=k.list_price,price_source=k.price_source,price_fetched_at=k.price_fetched_at
from public.book_metadata_cache k where b.isbn=k.normalized_isbn and b.list_price is null and k.list_price>0;

-- Provider-verified identity for the one previously ISBN-less volume.
update public.books set isbn='9784065251454',list_price=528,price_source='rakuten',price_fetched_at='2026-10-24T14:57:49.184Z'::timestamptz where id='c1aa4533-3a5a-4b24-8ec9-935062b1b521' and isbn is null and list_price is null and title='彼女、人見知ります 3' and series_title='彼女、人見知ります' and volume_number=3 returning title,isbn,list_price;

