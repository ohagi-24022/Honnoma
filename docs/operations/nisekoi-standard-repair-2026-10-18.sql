-- The reporter identified a normal-series bulk registration mixup in volumes 2-14.
-- Never relabel the paperback catalog itself or change other users' editions.
begin;
create temporary table nisekoi_standard_verified(isbn text,volume integer,cover_url text,source_url text,expected_old_isbn text) on commit drop;
insert into nisekoi_standard_verified values
('9784088704548',1,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088704548/500/9784088704548.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088704548',''),
('9784088704708',2,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088704708/500/9784088704708.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088704708','9784086197991'),
('9784088705033',3,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088705033/500/9784088705033.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088705033','9784086198004'),
('9784088705385',4,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088705385/500/9784088705385.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088705385','9784086198011'),
('9784088706023',5,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088706023/500/9784088706023.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088706023','9784086198028'),
('9784088706306',6,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088706306/500/9784088706306.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088706306','9784086198035'),
('9784088706658',7,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088706658/500/9784088706658.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088706658','9784086198042'),
('9784088708058',8,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088708058/500/9784088708058.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088708058','9784086198059'),
('9784088708386',9,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088708386/500/9784088708386.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088708386','9784086198066'),
('9784088708904',10,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088708904/500/9784088708904.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088708904','9784086198073'),
('9784088800264',11,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088800264/500/9784088800264.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088800264','9784086198080'),
('9784088800585',12,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088800585/500/9784088800585.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088800585','9784086198097'),
('9784088801520',13,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088801520/500/9784088801520.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088801520','9784086198103'),
('9784088801926',14,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088801926/500/9784088801926.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088801926','9784086198110'),
('9784088802220',15,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088802220/500/9784088802220.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088802220',''),
('9784088803036',16,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088803036/500/9784088803036.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088803036',''),
('9784088803302',17,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088803302/500/9784088803302.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088803302',''),
('9784088803661',18,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088803661/500/9784088803661.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088803661',''),
('9784088804460',19,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088804460/500/9784088804460.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088804460',''),
('9784088804835',20,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088804835/500/9784088804835.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088804835',''),
('9784088805801',21,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088805801/500/9784088805801.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088805801',''),
('9784088806501',22,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088806501/500/9784088806501.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088806501',''),
('9784088807171',23,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088807171/500/9784088807171.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088807171',''),
('9784088807492',24,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088807492/500/9784088807492.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088807492',''),
('9784088808055',25,'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088808055/500/9784088808055.jpg','https://www.shueisha.co.jp/books/items/contents.html?isbn=9784088808055','');
insert into public.book_metadata_overrides(isbn,normalized_isbn,title,series_title,series_key,volume_number,author,publisher,thumbnail_url,source_url)
select isbn,isbn,'ニセコイ '||volume,'ニセコイ','ニセコイ',volume,'古味直志','集英社',cover_url,source_url from nisekoi_standard_verified
on conflict(normalized_isbn) where normalized_isbn is not null do nothing;
do $$ declare changed integer; begin
update public.books b set isbn=v.isbn,thumbnail_url=v.cover_url from nisekoi_standard_verified v
where b.user_id='__TARGET_USER_ID__'::uuid and b.series_title='ニセコイ' and b.volume_kind='main'
and b.volume_number=v.volume and b.isbn=v.expected_old_isbn and v.volume between 2 and 14
and not exists(select 1 from public.books other where other.user_id=b.user_id and other.isbn=v.isbn and other.id<>b.id);
get diagnostics changed = row_count;
if changed<>13 then raise exception 'Expected 13 reported bulk-registration editions, found %',changed; end if;
end $$;
commit;
