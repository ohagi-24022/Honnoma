-- Publisher-verified comic editions. Preserve personal names, reading and purchase records.
begin;
insert into public.book_metadata_overrides
(isbn,normalized_isbn,title,series_title,series_key,volume_number,book_format,volume_kind,publisher,author,description,thumbnail_url,source_url,source,enabled)
values
('9784757560062','9784757560062','りゅうおうのおしごと！ 9','りゅうおうのおしごと!','りゅうおうのおしごと',9,'comic','main','スクウェア・エニックス','白鳥士郎, カズキ, こげたおこげ, しらび, 西遊棋',
'辿り着け『光』に――。
祭神雷という圧倒的な才能の持ち主と関わり、今まで信じていた「強さ」を疑い始めたあい。師弟がすれ違ったまま、「マイナビ女子オープン」の決勝戦が始まる。「強さの正解はひとつじゃないんだ」諭し続ける八一の声はあいに届くのか――。答えは天才少女の手の中に、ずっと握りしめられていた。「強さ」とは何かを改めて問い直す、「熱血将棋ラノベ」マンガ版第９巻!!',
'https://magazine.jp.square-enix.com/top/shoei/9784757560062.jpg?t=20250207124355','https://magazine.jp.square-enix.com/top/comics/detail/9784757560062/','developer',true),
('9784757562448','9784757562448','りゅうおうのおしごと！ 10（完）','りゅうおうのおしごと!','りゅうおうのおしごと',10,'comic','main','スクウェア・エニックス','白鳥士郎, カズキ, こげたおこげ, しらび, 西遊棋',
'熱血将棋ラノベ漫画版、大団円!!
清滝一門inハワイ!!師匠や姉弟子達の全力バックアップを受け、気力体力共に万全の八一（やいち）が、最強の挑戦者・名人との竜王防衛戦に臨む。竜王VS将棋界の神。名人の『毒』は、八一の将棋だけでなく、人生や周囲との繋がりさえも否定していく。世界が壊れていく音の中、彼を待つものとは――？弟子（キミ）と出会って始まった物語は、最終決戦でひとつの奇跡を起こす。「熱血将棋ラノベ」マンガ版感動のフィナーレ!!',
'https://magazine.jp.square-enix.com/top/shoei/9784757562448.jpg?t=20250207124355','https://magazine.jp.square-enix.com/top/comics/detail/9784757562448/','developer',true)
on conflict(normalized_isbn) where normalized_isbn is not null do update set
title=excluded.title,series_title=excluded.series_title,series_key=excluded.series_key,
volume_number=excluded.volume_number,book_format=excluded.book_format,volume_kind=excluded.volume_kind,
publisher=excluded.publisher,author=excluded.author,description=excluded.description,
thumbnail_url=excluded.thumbnail_url,source_url=excluded.source_url,enabled=true,updated_at=now();

update public.books set isbn='9784757560062',
thumbnail_url='https://magazine.jp.square-enix.com/top/shoei/9784757560062.jpg?t=20250207124355',
book_format='comic',publisher=coalesce(publisher,'スクウェア・エニックス'),
author=coalesce(author,'白鳥士郎, カズキ, こげたおこげ, しらび, 西遊棋')
where id='15ff3560-da8f-4661-951c-c92368f32a58' and user_id='46dd42a1-4ca1-4dd2-b638-118b5c68f11d'
and isbn is null and thumbnail_url is null and volume_number=9;
update public.books set isbn='9784757562448'
where id='56bba055-ed34-4641-9c12-d6f5f41251b9' and user_id='46dd42a1-4ca1-4dd2-b638-118b5c68f11d'
and isbn='' and volume_number=10;
select id,isbn,title,book_format,thumbnail_url is not null as has_cover
from public.books where id in ('15ff3560-da8f-4661-951c-c92368f32a58','56bba055-ed34-4641-9c12-d6f5f41251b9');
commit;
