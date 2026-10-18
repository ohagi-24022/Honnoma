do $test$
declare fixture_isbn text := '9799999999983'; expected_cover text;
begin
 begin
  if exists(select 1 from public.book_content_review_jobs where isbn13=fixture_isbn) then raise exception 'Fixture already exists'; end if;
  create temporary table wishlist_cover_fixture(id int,title text,isbn text,cover_url text) on commit drop;
  create trigger align_wanted_cover_identity before insert or update of isbn,cover_url on wishlist_cover_fixture
    for each row execute function public.align_wanted_cover_identity();
  create trigger queue_book_content_on_wanted after insert or update of isbn,cover_url on wishlist_cover_fixture
    for each row execute function public.queue_registered_book_content();
  select cover_url into expected_cover from public.reviewed_book_content where isbn13='9784088800158' and enabled;
  if expected_cover is null then raise exception 'Expected approved fixture cover'; end if;
  insert into wishlist_cover_fixture values(1,'Known cover',null,'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0158/9784088800158.jpg?_ex=200x200');
  if not exists(select 1 from wishlist_cover_fixture where id=1 and isbn='9784088800158' and cover_url=expected_cover) then raise exception 'Legacy cover did not resolve'; end if;
  insert into wishlist_cover_fixture values(2,'Wrong host',null,'https://attacker.test/9784088800158.jpg');
  if (select isbn is not null from wishlist_cover_fixture where id=2) then raise exception 'Unknown host used'; end if;
  insert into wishlist_cover_fixture values(3,'Legacy wishlist intake',null,null);
  update wishlist_cover_fixture set cover_url='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/9983/'||fixture_isbn||'.jpg' where id=3;
  if not exists(select 1 from public.book_content_review_jobs where isbn13=fixture_isbn and title='Legacy wishlist intake' and candidate is null and status='queued') then raise exception 'Cover-only UPDATE did not enqueue'; end if;
  insert into wishlist_cover_fixture values(4,'Invalid checksum',null,'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0159/9784088800159.jpg');
  if (select isbn is not null from wishlist_cover_fixture where id=4) then raise exception 'Invalid ISBN inferred'; end if;
  insert into wishlist_cover_fixture values(5,'Explicit ISBN','9784088800158','https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/7315/9784088827315.jpg');
  if not exists(select 1 from wishlist_cover_fixture where id=5 and isbn='9784088800158' and cover_url=expected_cover) then raise exception 'Explicit ISBN overwritten'; end if;
  raise exception using errcode='Z0001', message='Rollback wishlist fixtures';
 exception when sqlstate 'Z0001' then null;
 end;
end $test$;
select not exists(select 1 from public.book_content_review_jobs where isbn13='9799999999983') as fixture_rolled_back;
