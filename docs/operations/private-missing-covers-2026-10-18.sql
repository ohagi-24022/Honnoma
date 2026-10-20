-- Only the reporter's missing private cover fields; never grants public approval.
with candidates as (
 select b.id,coalesce(r.cover_url,
  case when c.metadata->>'thumbnail_url' ~ '^https://' then c.metadata->>'thumbnail_url' end,
  case when length(j.candidate->>'cover_hash')=64 then j.candidate->>'cover_url' end) as cover_url
 from public.books b
 left join public.confirmed_book_metadata c on c.normalized_isbn=b.isbn and c.enabled
 left join public.reviewed_book_content r on r.isbn13=b.isbn and r.enabled
 left join public.book_content_review_jobs j on j.isbn13=b.isbn
 where b.user_id='__TARGET_USER_ID__'::uuid and coalesce(b.thumbnail_url,'')=''
), changed as (
 update public.books b set thumbnail_url=c.cover_url from candidates c where c.id=b.id
 and c.cover_url ~ '^https://' and
 (substring(c.cover_url from '(97[89][0-9]{10})') is null or substring(c.cover_url from '(97[89][0-9]{10})')=b.isbn)
 returning b.isbn)
select count(*) as filled from changed;
