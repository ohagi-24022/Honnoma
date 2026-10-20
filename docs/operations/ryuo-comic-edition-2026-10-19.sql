begin;
update public.books set isbn='9784757549920',publisher='スクウェア・エニックス',book_format='comic',thumbnail_url='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/9920/9784757549920.jpg?_ex=600x600'
where id='d8ba58dc-4dd7-424b-b86e-d20414a0cc09' and user_id='__TARGET_USER_ID__'
and isbn='9784797386769' and volume_number=2 and series_title='りゅうおうのおしごと!';
update public.books set thumbnail_url='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0711/9784757550711.jpg?_ex=600x600'
where id='dd50141d-336c-4d2c-9350-dc8d7bab0548' and user_id='__TARGET_USER_ID__'
and isbn='9784757550711' and volume_number=3 and thumbnail_url like '%9784797388176%';
insert into public.book_metadata_overrides(isbn,normalized_isbn,title,series_title,series_key,volume_number,book_format,volume_kind,publisher,author,thumbnail_url,source_url,source,enabled)
values ('9784757549920','9784757549920','りゅうおうのおしごと！（2）','りゅうおうのおしごと!','りゅうおうのおしごと',2,'comic','main','スクウェア・エニックス','白鳥士郎, カズキ, こげたおこげ, しらび','https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/9920/9784757549920.jpg?_ex=600x600','https://orig-magazine.jp.square-enix.com/top/comics/detail/9784757549920/','developer',true)
on conflict(normalized_isbn) where normalized_isbn is not null do update set book_format='comic',volume_kind='main',updated_at=now();
commit;
select volume_number,isbn,publisher,book_format,left(thumbnail_url,180) thumbnail_url from public.books where user_id='__TARGET_USER_ID__' and id in ('d8ba58dc-4dd7-424b-b86e-d20414a0cc09','dd50141d-336c-4d2c-9350-dc8d7bab0548');
