-- Remove the stray period from volume 1 and its subscription label.
-- Publisher reference: https://www.s-manga.net/items/contents.html?isbn=9784088916507
-- Use the existing administrator correction mechanism to keep provider refreshes
-- from restoring the incorrect name. Media approvals and purchase data are unchanged.
begin;
insert into public.book_metadata_overrides
  (isbn,normalized_isbn,title,series_title,series_key,volume_number,source_url)
select '9784088916507','9784088916507','推しの子 1','推しの子','推しの子',1,
  'https://www.s-manga.net/items/contents.html?isbn=9784088916507'
where not exists (select 1 from public.book_metadata_overrides where normalized_isbn='9784088916507');

update public.books set series_title='推しの子'
where id='003182a3-40d9-4948-904e-de4b65dc4220'
  and isbn='9784088916507' and series_title='推しの子.';
update public.series_subscriptions set series_title='推しの子'
where series_key='推しの子' and series_title='推しの子.';

do $$ begin
  if not exists (select 1 from public.book_metadata_cache
    where normalized_isbn='9784088916507' and title='推しの子 1' and series_title='推しの子') then
    raise exception 'Corrected cache title was not saved';
  end if;
  if exists (select 1 from public.books where isbn='9784088916507' and series_title='推しの子.') then
    raise exception 'Incorrect saved series title remains';
  end if;
end $$;
commit;
