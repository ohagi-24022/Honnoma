-- Fill only missing identifiers/covers in the reporting user's standard edition set.
begin;
create temporary table hitman_verified(isbn text,volume integer,cover_url text,source_url text) on commit drop;
insert into hitman_verified values
('9784065130872',1,'https://dvs-cover.kodansha.co.jp/0000313787/nWUPeN72u173jrcy0xaqyScUYLvfq4u7A5hBUBdo.jpg','https://www.kodansha.co.jp/comic/products/0000313787'),
('9784065134924',2,'https://dvs-cover.kodansha.co.jp/0000314787/GKEsX21Ieplx2mDX6h2zMOqltSyeJqJ6AcHh4r1A.jpg','https://www.kodansha.co.jp/comic/products/0000314787'),
('9784065144480',3,'https://dvs-cover.kodansha.co.jp/0000319486/7iI69SV2RtaMZtyjFOEP0Gilnb08EcgHjnN4Ks4N.jpg','https://www.kodansha.co.jp/comic/products/0000319486'),
('9784065151419',4,'https://dvs-cover.kodansha.co.jp/0000321125/PLRmeaXxUkpKna5XRdWUqt99BNEYy5wD4vaCVsut.jpg','https://www.kodansha.co.jp/comic/products/0000321125'),
('9784065157282',5,'https://dvs-cover.kodansha.co.jp/0000322247/KBxGJQ9CyrOJKlqF2rVbDhirkE5fqKbvfYBEFx8H.jpg','https://www.kodansha.co.jp/comic/products/0000322247'),
('9784065171684',6,'https://dvs-cover.kodansha.co.jp/0000324945/Cyed02QphMSNsoLL9oCpt9LpjlQ4rldQZ9JVAiDz.jpg','https://www.kodansha.co.jp/comic/products/0000324945'),
('9784065175484',7,'https://dvs-cover.kodansha.co.jp/0000325781/KMqIKSeVixo68vqqHig6Z876N5loE60gdhxfpbbS.jpg','https://www.kodansha.co.jp/comic/products/0000325781'),
('9784065182680',8,'https://dvs-cover.kodansha.co.jp/0000328013/EEyZKpvB9hG3tJwVC241EUOc5VewXMU4jV6W47jd.jpg','https://www.kodansha.co.jp/comic/products/0000328013'),
('9784065188576',9,'https://dvs-cover.kodansha.co.jp/0000338524/WPvCvmQYNQJMeYq2DLDUGmSIZWYL8MGgdwE8FdU4.jpg','https://www.kodansha.co.jp/comic/products/0000338524'),
('9784065201091',10,'https://dvs-cover.kodansha.co.jp/0000342942/uqMLmR0hQArPGvI7oFXlYCSGeBzuw8kzSxYPxmRx.jpg','https://www.kodansha.co.jp/comic/products/0000342942'),
('9784065210161',11,'https://dvs-cover.kodansha.co.jp/0000345085/uQJs8NonKUxkbpamuMhEBOzm6y8OU2Hlf38qh3xo.jpg','https://www.kodansha.co.jp/comic/products/0000345085'),
('9784065216347',12,'https://dvs-cover.kodansha.co.jp/0000347247/4PGsyCYlzbX5dWIl4u9XaklTqlyacU1shgd6A3AU.jpg','https://www.kodansha.co.jp/comic/products/0000347247'),
('9784065226544',13,'https://dvs-cover.kodansha.co.jp/0000350175/Vm1jHrUbxfxyAnT5CGRTdzRdAwSfBGyLVWRybRUr.jpg','https://www.kodansha.co.jp/comic/products/0000350175');
insert into public.book_metadata_overrides(isbn,normalized_isbn,title,series_title,series_key,volume_number,author,publisher,thumbnail_url,source_url)
select isbn,isbn,'ヒットマン '||volume,'ヒットマン','ヒットマン',volume,'瀬尾公治','講談社',cover_url,source_url from hitman_verified
on conflict(normalized_isbn) where normalized_isbn is not null do nothing;
with changed as(update public.books b set isbn=v.isbn,thumbnail_url=v.cover_url
from hitman_verified v where b.user_id='__TARGET_USER_ID__'::uuid and b.series_title='ヒットマン'
and b.volume_kind='main' and b.volume_number=v.volume and b.isbn is null
and not exists(select 1 from public.books other where other.user_id=b.user_id and other.isbn=v.isbn and other.id<>b.id)
returning b.volume_number)
select count(*) as filled from changed;
commit;
