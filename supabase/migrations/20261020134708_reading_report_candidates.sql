-- Offer reviewed public book series, independently of ranking popularity thresholds.
create or replace function public.get_series_reading_report_candidates(limit_count integer default 4)
returns table(series_title text, report_count bigint)
language sql volatile security definer set search_path='' as $$
with sources as (
  select coalesce(nullif(m.metadata->>'series_title',''),nullif(j.candidate->>'series_title',''),
    regexp_replace(normalize(j.candidate->>'title',NFKC),
      '([[:space:]]+(volume|vol[.]?)?[[:space:]]*[0-9]+|[[:space:]]*[(][0-9]+[)]|[[:space:]]*[0-9]+巻)$','','i')) as title
  from public.book_content_review_jobs j
  join public.reviewed_book_content r using(isbn13)
  left join public.confirmed_book_metadata m on m.normalized_isbn=j.isbn13 and m.enabled
  where j.adult_only=false and r.enabled and r.cover_url is not null and j.candidate->>'title' is not null
    and coalesce(nullif(m.metadata->>'book_format',''),j.candidate->>'book_format','comic')<>'novel'
    and (select auth.uid()) is not null
), plain as (
  select distinct btrim(title) as title from sources where nullif(btrim(title),'') is not null
), names as (
  select coalesce(c.title,p.title) as title from plain p
  left join public.public_ranking_aliases a on a.alias_key=lower(regexp_replace(normalize(p.title,NFKC),'[[:space:]\[\]()]','','g'))
  left join public.public_ranking_catalog c on c.ranking_key=a.ranking_key and c.adult_only=false
), keys as (
  select distinct title,replace(translate(lower(normalize(title,NFKC)),
    E' 　・･:：-–—_\'"“”‘’()[]{}「」『』【】〈〉《》!?！？。.．',''),'僕モブを','僕を') as key from names
), candidates as (
  select k.key,min(k.title) as title from keys k group by k.key
), ranked as (
  select c.title,count(distinct s.user_id) as reports
  from candidates c left join public.series_reading_suggestions s on s.series_key=c.key
  where not exists(select 1 from public.series_reading_suggestions own where own.user_id=(select auth.uid()) and own.series_key=c.key)
  group by c.key,c.title
)
select title,reports from ranked order by reports,random()
limit greatest(1,least(coalesce(limit_count,4),20));
$$;
revoke all on function public.get_series_reading_report_candidates(integer) from public,anon;
grant execute on function public.get_series_reading_report_candidates(integer) to authenticated;
