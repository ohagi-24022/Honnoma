-- Keep intake visible while the independent AI switch is OFF. This is a private
-- administrative label from registration, not a confirmed publication candidate.
create or replace function public.queue_registered_book_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_isbn text; v_title text;
begin
  v_isbn := case when tg_table_name = 'book_metadata_cache'
    then coalesce(to_jsonb(new)->>'normalized_isbn',to_jsonb(new)->>'isbn')
    else to_jsonb(new)->>'isbn' end;
  v_isbn := regexp_replace(coalesce(v_isbn,''),'[^0-9]','','g');
  perform public.enqueue_book_content_reviews(array[v_isbn]);
  v_title := nullif(btrim(to_jsonb(new)->>'title'),'');
  if v_title is not null then
    update public.book_content_review_jobs set title = left(v_title,500)
    where isbn13=v_isbn and title is null and candidate is null
      and status in ('queued','retry') and classification_source is null;
  end if;
  return new;
end $$;
revoke all on function public.queue_registered_book_content() from public, anon, authenticated;

-- Backfill labels only for unprepared, unclassified intake. Never alter existing
-- reviews, hashes, approvals, candidates, user libraries or the AI switch.
with labels as (
  select regexp_replace(isbn,'[^0-9]','','g') isbn13, min(title) title
  from public.books where isbn is not null and btrim(title) <> ''
  group by regexp_replace(isbn,'[^0-9]','','g')
  having count(distinct title)=1
)
update public.book_content_review_jobs j set title=left(labels.title,500)
from labels where j.isbn13=labels.isbn13 and j.title is null and j.candidate is null
  and j.status in ('queued','retry') and j.classification_source is null;
