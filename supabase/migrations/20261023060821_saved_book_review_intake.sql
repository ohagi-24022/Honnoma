-- Browsing a cover is not a request for paid classification. Preserve prior
-- administrative imports and decisions; park only proven unsaved search intake.
alter table public.book_content_review_jobs
  add column review_requested boolean not null default true;

create function public.is_saved_book_review_isbn(p_isbn text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.books where isbn=p_isbn)
    or exists(select 1 from public.wanted_manga where isbn=p_isbn
      or (isbn is null and cover_url ~ ('/' || p_isbn || '([_.?]|$)')));
$$;
revoke all on function public.is_saved_book_review_isbn(text) from public,anon,authenticated;
grant execute on function public.is_saved_book_review_isbn(text) to service_role;

-- Cache fills happen during searches as well as registration. Real persistence
-- is already covered by the books and wanted_manga AFTER triggers.
drop trigger if exists queue_book_content_on_metadata on public.book_metadata_cache;

update public.book_content_review_jobs j set review_requested=false,
  reason='検索候補として保管。本棚・欲しいリストへの保存後に確認対象へ戻します。'
where created_at >= '2026-10-20T00:00:00Z' and adult_only is null
  and classification_source is null and attempts=0
  and status in ('queued','retry','pending_review')
  and candidate->>'review_origin'='registration'
  and not public.is_saved_book_review_isbn(isbn13)
  and not exists(select 1 from public.reviewed_book_content r where r.isbn13=j.isbn13);

create or replace function public.enqueue_book_content_reviews(p_isbns text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_isbn text; v_count integer := 0; v_changed integer;
begin
  perform pg_advisory_xact_lock(706071);
  for v_isbn in select distinct x from unnest(p_isbns[1:20]) x loop
    if v_isbn !~ '^(978|979)[0-9]{10}$' or not public.is_saved_book_review_isbn(v_isbn) then continue; end if;
    if (select count(*) from public.book_content_review_jobs where created_at >= current_date) >= 1000 then exit; end if;
    insert into public.book_content_review_jobs (isbn13) values (v_isbn)
    on conflict (isbn13) do update set review_requested=true,
      status=case when not book_content_review_jobs.review_requested then 'queued' else book_content_review_jobs.status end,
      available_at=now(),updated_at=now()
      where not book_content_review_jobs.review_requested;
    get diagnostics v_changed = row_count;
    v_count := v_count + v_changed;
  end loop;
  if v_count > 0 then perform public.wake_book_content_review(); end if;
  return v_count;
end $$;
revoke all on function public.enqueue_book_content_reviews(text[]) from public,anon,authenticated;
grant execute on function public.enqueue_book_content_reviews(text[]) to service_role;

create or replace function public.claim_book_content_review() returns setof public.book_content_review_jobs
language plpgsql security definer set search_path = '' as $$
declare v_config public.book_content_review_config; v_isbn text;
begin
  select * into v_config from public.book_content_review_config where id for update;
  if not v_config.enabled then return; end if;
  if v_config.budget_day is distinct from current_date then
    update public.book_content_review_config set budget_day=current_date, attempts_today=0 where id;
    v_config.attempts_today := 0;
  end if;
  if v_config.attempts_today >= v_config.daily_limit then return; end if;
  select isbn13 into v_isbn from public.book_content_review_jobs
    where review_requested and classification_source is distinct from 'manual' and (
      (status in ('queued','retry') and available_at <= now())
      or (status='processing' and lease_until < now())
      -- Metadata-only preparation must not make a newly saved book disappear
      -- from the AI queue. A completed/uncertain AI result is never auto-retried.
      or (status='pending_review' and attempts=0 and assessment is null
        and adult_only is null and candidate->>'review_origin'='registration'
        and public.is_saved_book_review_isbn(isbn13) and available_at <= now())
    ) order by available_at for update skip locked limit 1;
  if v_isbn is null then return; end if;
  update public.book_content_review_config set attempts_today=attempts_today+1 where id;
  return query update public.book_content_review_jobs set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
    where isbn13=v_isbn returning *;
end $$;
revoke all on function public.claim_book_content_review() from public,anon,authenticated;
grant execute on function public.claim_book_content_review() to service_role;
