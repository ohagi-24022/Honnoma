begin;
-- Exercise the actual trigger function against isolated rows, without modifying a library
-- or firing the production content-review queue.
create temporary table series_name_fixture (
  id integer primary key,
  series_title text not null,
  series_aliases text[] not null default '{}'
);
create trigger remember_book_series_names
before update of series_title on series_name_fixture
for each row when (old.series_title is distinct from new.series_title)
execute function public.remember_book_series_names();
insert into series_name_fixture(id,series_title) values (1,'元の作品'), (2,'他ユーザーの作品');
update series_name_fixture set series_title='変更後' where id=1;
update series_name_fixture set series_title='もう一度変更', series_aliases='{}' where id=1;
update series_name_fixture set series_title='元の作品' where id=1;
do $$
begin
  if not (select series_aliases @> array['元の作品','変更後','もう一度変更'] from series_name_fixture where id=1) then
    raise exception 'Rename history was lost';
  end if;
  if not (select series_title='他ユーザーの作品' and cardinality(series_aliases)=0 from series_name_fixture where id=2) then
    raise exception 'Unrelated row changed';
  end if;
  if has_function_privilege('anon','public.remember_book_series_names()','execute')
     or has_function_privilege('authenticated','public.remember_book_series_names()','execute') then
    raise exception 'Internal trigger exposed as RPC';
  end if;
end $$;
rollback;
