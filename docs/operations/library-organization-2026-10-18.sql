-- Scope: the reporting user's existing library only. Run after selecting novels.
-- Does not replace known manual comic/novel classifications.
begin;
with changed as (
update public.books set book_format=case
 when isbn in ('9784087032925','9784087033076','9784087033557','9784797386769') then 'novel'
 else 'comic' end
where user_id='__TARGET_USER_ID__'::uuid and (book_format is null or book_format='unknown')
returning book_format)
select book_format,count(*) from changed group by book_format;
with targets(isbn,expected_series,parent_series) as (values
 ('9784088807041','ワールドトリガーオフィシャルデータブックBORDER BRIEFING FILE','ワールドトリガー'),
 ('9784088805399','ニセコイファンブックトクレポ','ニセコイ'),
 ('9784065203330','彼女、お借りします公式アンソロジー','彼女、お借りします.'),
 ('9784832246546','がっこうぐらし!アンソロジー','がっこうぐらし!')),
changed as (
update public.books b set series_title=t.parent_series,volume_kind='extra',
series_aliases=case when b.series_title=any(coalesce(b.series_aliases,array[]::text[])) then b.series_aliases else array_append(coalesce(b.series_aliases,array[]::text[]),b.series_title) end
from targets t where b.user_id='__TARGET_USER_ID__'::uuid and b.isbn=t.isbn and b.series_title=t.expected_series
and exists(select 1 from public.books base where base.user_id=b.user_id and base.series_title=t.parent_series and base.volume_kind='main')
returning b.isbn,b.series_title)
select * from changed;
commit;
