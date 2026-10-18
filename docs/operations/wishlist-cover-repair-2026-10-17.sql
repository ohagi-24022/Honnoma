-- Bind the verified account at execution time; this is not a global library sweep.
begin;
with repaired as (
  update public.wanted_manga set isbn=isbn,cover_url=cover_url
  where user_id='__TARGET_USER_ID__'::uuid and isbn is null
    and substring(cover_url from '^https://thumbnail[.]image[.]rakuten[.]co[.]jp/@0_mall/book/cabinet/(?:[0-9]+/)*((?:978|979)[0-9]{10})(?:[_.?]|$)')
      =any(array['9784088928623','9784088840505','9784046852663','9784107720290','9784088827315','9784758024389','9784046818812','9784088800158'])
  returning isbn
)
select set_config('honnoma.repaired_wishlist',count(*)::text,true) from repaired;
do $guard$ begin
 if current_setting('honnoma.repaired_wishlist')::integer<>8 then raise exception 'Expected exactly 8 reported wishlist items'; end if;
end $guard$;
commit;
select count(*) filter(where w.isbn is not null) identified_items,
  count(*) filter(where r.enabled and r.cover_url=w.cover_url) approved_covers,
  count(*) filter(where j.isbn13 is not null) queued_or_reviewed_items
from public.wanted_manga w
left join public.reviewed_book_content r on r.isbn13=w.isbn
left join public.book_content_review_jobs j on j.isbn13=w.isbn
where w.user_id='__TARGET_USER_ID__'::uuid;
