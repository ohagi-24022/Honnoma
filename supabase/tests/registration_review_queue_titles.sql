-- An exception subtransaction rolls back fixture writes without depending on an
-- API client's handling of explicit BEGIN / ROLLBACK result sets.
do $test$
begin
 begin
  create temporary table intake_fixture(isbn text, title text) on commit drop;
  create trigger queue_test_intake after insert or update of isbn on intake_fixture
  for each row execute function public.queue_registered_book_content();
  if exists(select 1 from public.book_content_review_jobs where isbn13='9799999999985') then raise exception 'Fixture already exists'; end if;
  insert into intake_fixture values('9799999999985','未確認の登録名');
  if not exists(select 1 from public.book_content_review_jobs where isbn13='9799999999985'
    and title='未確認の登録名' and candidate is null and content_hash is null and status='queued' and adult_only is null)
  then raise exception 'Missing intake title or unsafe approval'; end if;
  update public.book_content_review_jobs set title='確認済みの名前',classification_source='manual',status='approved',checked_at=now() where isbn13='9799999999985';
  update intake_fixture set isbn=isbn,title='上書きしてはいけない名前';
  if not exists(select 1 from public.book_content_review_jobs where isbn13='9799999999985' and title='確認済みの名前' and classification_source='manual' and status='approved')
  then raise exception 'Manual review changed'; end if;
  insert into intake_fixture values(null,'ISBNなしの本');
  raise exception using errcode='Z0001', message='Rollback successful fixture';
 exception when sqlstate 'Z0001' then null;
 end;
end $test$;
select not exists(select 1 from public.book_content_review_jobs where isbn13='9799999999985') as fixture_rolled_back;
