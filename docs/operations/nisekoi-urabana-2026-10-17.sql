-- Official JUMP j BOOKS editions only. No owned-book or content approval changes.
-- Keep a distinct series for installed clients which lack companion classification.
begin;
do $$
begin
 if exists(select 1 from public.book_metadata_overrides where normalized_isbn in ('9784087032925','9784087033076','9784087033557')) then
  raise exception 'Existing corrections require manual comparison';
 end if;
end $$;
insert into public.book_metadata_overrides
 (isbn,normalized_isbn,title,series_title,series_key,volume_number,author,publisher,thumbnail_url,source_url)
values
('9784087032925','9784087032925','ニセコイ ウラバナ 1','ニセコイ ウラバナ','ニセコイウラバナ',1,'古味直志, 田中創','集英社','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087032925/500/9784087032925.jpg','https://j-books.shueisha.co.jp/books/nisekoiurabana_01.html'),
('9784087033076','9784087033076','ニセコイ ウラバナ 2','ニセコイ ウラバナ','ニセコイウラバナ',2,'古味直志, 田中創','集英社','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087033076/500/9784087033076.jpg','https://j-books.shueisha.co.jp/books/nisekoiurabana_02.html'),
('9784087033557','9784087033557','ニセコイ ウラバナ 3','ニセコイ ウラバナ','ニセコイウラバナ',3,'古味直志, 田中創','集英社','https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087033557/500/9784087033557.jpg','https://j-books.shueisha.co.jp/books/nisekoiurabana_03.html');
commit;
