alter table public.book_content_review_jobs add column adult_only boolean;

-- Classification is distinct from permission to display a particular cover/description.
create function public.classify_book_content_review(p_isbn text,p_hash text,p_adult boolean,p_cover text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.book_content_review_jobs; approved boolean;
begin
  select * into j from public.book_content_review_jobs where isbn13=p_isbn for update;
  if not found or j.content_hash is distinct from p_hash or j.candidate is null or p_adult is null then return false; end if;
  if p_cover is not null and (p_adult or p_cover not like '%/storage/v1/object/public/reviewed-book-covers/%') then raise exception 'Invalid cover approval'; end if;
  approved := p_cover is not null;
  if p_adult then
    update public.reviewed_book_content set enabled=false,review_source='manual',reviewed_at=now() where isbn13=p_isbn;
  elsif approved then
    insert into public.reviewed_book_content(isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
      values(p_isbn,p_cover,null,j.candidate->>'source_url',true,'manual',p_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,
      description=case when reviewed_book_content.content_hash=excluded.content_hash then reviewed_book_content.description else null end,
      source_url=excluded.source_url,enabled=true,review_source='manual',content_hash=excluded.content_hash,reviewed_at=now();
  end if;
  update public.book_content_review_jobs set adult_only=p_adult,
    status=case when p_adult then 'rejected' when approved then 'approved' when status in ('approved','pending_review') then status else 'pending_review' end,
    cover_status=case when p_adult then 'held' when approved then 'approved' else cover_status end,
    description_status=case when p_adult then 'held' else description_status end,
    reason=case when p_adult then '管理者が成人向けに分類' when approved then '管理者が一般向けに分類し、表紙を確認' else '一般向けに分類済み。表紙・紹介文の表示確認は別途必要です。' end,
    lease_token=null,lease_until=null,checked_at=now(),updated_at=now() where isbn13=p_isbn;
  -- Existing public catalog entries must exclude adult titles. General classification does not automatically publish a series.
  update public.public_ranking_catalog set adult_only=p_adult,enabled=case when p_adult then false else enabled end,reviewed_at=now() where isbn=p_isbn;
  update public.book_content_review_mail set status='cancelled' where isbn13=p_isbn and status in ('pending','sending');
  return true;
end $$;
revoke all on function public.classify_book_content_review(text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.classify_book_content_review(text,text,boolean,text) to service_role;

-- Prepare public book data for human review without calling the AI or generating a notification for a deliberate preload.
create function public.prepare_book_content_review(p_isbn text,p_hash text,p_candidate jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_isbn !~ '^(978|979)[0-9]{10}$' or length(p_hash)<>64 or coalesce(p_candidate->>'title','')='' then raise exception 'Invalid candidate'; end if;
  if exists(select 1 from public.reviewed_book_content where isbn13=p_isbn and review_source='manual') then return false; end if;
  insert into public.book_content_review_jobs(isbn13,title,candidate,content_hash,status,reason)
    values(p_isbn,left(p_candidate->>'title',1000),p_candidate,p_hash,'pending_review','手動の事前確認用データ')
    on conflict(isbn13) do update set title=excluded.title,candidate=excluded.candidate,content_hash=excluded.content_hash,status='pending_review',
      cover_status='unreviewed',description_status='unreviewed',assessment=null,lease_token=null,lease_until=null,reason=excluded.reason,updated_at=now()
      where book_content_review_jobs.adult_only is null and book_content_review_jobs.status in ('queued','retry','pending_review');
  return found;
end $$;
revoke all on function public.prepare_book_content_review(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_book_content_review(text,text,jsonb) to service_role;
