begin;
create temporary table sosei_novel_verified(isbn text,title text,cover_url text,source_url text) on commit drop;
insert into sosei_novel_verified values
('9784087034028','双星の陰陽師 ―天縁若虎―','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087034028/500/9784087034028.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784087034028'),
('9784087034158','双星の陰陽師 ―士牙繭闢―','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087034158/500/9784087034158.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784087034158'),
('9784087034677','双星の陰陽師 ―三天破邪―','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087034677/500/9784087034677.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784087034677');
insert into public.book_metadata_overrides(isbn,normalized_isbn,title,series_title,series_key,author,publisher,thumbnail_url,source_url)
select isbn,isbn,title,'双星の陰陽師','双星の陰陽師','助野嘉昭, 田中創','集英社',cover_url,source_url from sosei_novel_verified
on conflict(normalized_isbn) where normalized_isbn is not null do nothing;
with changed as(update public.books b set title=v.title,series_title='双星の陰陽師',volume_kind='extra',book_format='novel',volume_number=null,thumbnail_url=v.cover_url,
series_aliases=case when b.series_title='双星の陰陽師' or b.series_title=any(coalesce(b.series_aliases,array[]::text[])) then b.series_aliases else array_append(coalesce(b.series_aliases,array[]::text[]),b.series_title) end
from sosei_novel_verified v where b.user_id='__TARGET_USER_ID__'::uuid and b.isbn=v.isbn
returning b.isbn,b.title,b.series_title,b.volume_kind,b.book_format)
select * from changed;
commit;
