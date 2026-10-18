-- Preserve existing administrator decisions and distinguish later AI classifications.
alter table public.book_content_review_jobs add column classification_source text
  check (classification_source in ('manual','ai'));
update public.book_content_review_jobs set classification_source='manual' where adult_only is not null;
CREATE OR REPLACE FUNCTION public.finish_book_content_review(p_isbn text, p_lease uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_job public.book_content_review_jobs; v_status text; v_hash text;
begin
  select * into v_job from public.book_content_review_jobs where isbn13=p_isbn for update;
  if not found or v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease then return false; end if;
  v_status := p_result->>'status'; v_hash := coalesce(p_result->>'content_hash',v_job.content_hash,'unavailable');
  if v_status not in ('approved','pending_review','retry','rejected') then raise exception 'Invalid result status'; end if;
  -- A manual decision cannot be overwritten by a late automatic result.
  if v_job.classification_source='manual' or exists(select 1 from public.reviewed_book_content where isbn13=p_isbn and review_source='manual') then
    update public.book_content_review_jobs set status=case when v_job.adult_only is true then 'rejected' when (select enabled from public.reviewed_book_content where isbn13=p_isbn) then 'approved' else 'pending_review' end,
      lease_token=null, lease_until=null, checked_at=now(), updated_at=now() where isbn13=p_isbn;
    return true;
  end if;
  if p_result ? 'adult_only' and jsonb_typeof(p_result->'adult_only') not in ('boolean','null') then raise exception 'Invalid audience'; end if;
  update public.book_content_review_jobs set adult_only=case when p_result ? 'adult_only' then (p_result->>'adult_only')::boolean else adult_only end,
    classification_source=case when p_result ? 'adult_only' then 'ai' else classification_source end,
    status=v_status, content_hash=coalesce(v_hash,content_hash),
    title=coalesce(p_result->>'title',title), candidate=coalesce(p_result->'candidate',candidate),
    assessment=coalesce(p_result->'assessment',assessment),
    cover_status=coalesce(p_result->>'cover_status',cover_status), description_status=coalesce(p_result->>'description_status',description_status),
    reason=left(p_result->>'reason',500), lease_token=null, lease_until=null,
    checked_at=case when v_status='retry' then checked_at else now() end,
    available_at=now()+make_interval(mins=>least(240,5*(2^least(v_job.attempts,5))::integer)), updated_at=now()
    where isbn13=p_isbn;
  if v_status <> 'retry' and p_result ? 'display' then
    -- AI may publish only a positively classified general-audience book.
    if (select adult_only from public.book_content_review_jobs where isbn13=p_isbn) is distinct from false
       and coalesce((p_result->'display'->>'enabled')::boolean,false) then raise exception 'Audience not approved'; end if;
    insert into public.reviewed_book_content (isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
    values (p_isbn,p_result->'display'->>'cover_url',p_result->'display'->>'description',p_result->'display'->>'source_url',
      coalesce((p_result->'display'->>'enabled')::boolean,false),'ai',v_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,description=excluded.description,source_url=excluded.source_url,
      enabled=excluded.enabled,review_source='ai',content_hash=excluded.content_hash,reviewed_at=now()
      where reviewed_book_content.review_source='ai';
  end if;
  if v_status='pending_review' then
    insert into public.book_content_review_mail (isbn13,content_hash) values(p_isbn,coalesce(v_hash,'unavailable'))
      on conflict(isbn13,content_hash) do nothing;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.classify_book_content_review(p_isbn text, p_hash text, p_adult boolean, p_cover text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.book_content_review_jobs set adult_only=p_adult,classification_source='manual',
    status=case when p_adult then 'rejected' when approved then 'approved' when status in ('approved','pending_review') then status else 'pending_review' end,
    cover_status=case when p_adult then 'held' when approved then 'approved' else cover_status end,
    description_status=case when p_adult then 'held' else description_status end,
    reason=case when p_adult then '管理者が成人向けに分類' when approved then '管理者が一般向けに分類し、表紙を確認' else '一般向けに分類済み。表紙・紹介文の表示確認は別途必要です。' end,
    lease_token=null,lease_until=null,checked_at=now(),updated_at=now() where isbn13=p_isbn;
  -- Existing public catalog entries must exclude adult titles. General classification does not automatically publish a series.
  update public.public_ranking_catalog set adult_only=p_adult,classification_source='manual',enabled=case when p_adult then false else enabled end,reviewed_at=now() where isbn=p_isbn;
  update public.book_content_review_mail set status='cancelled' where isbn13=p_isbn and status in ('pending','sending');
  return true;
end $function$;

revoke all on function public.finish_book_content_review(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_book_content_review(text,uuid,jsonb) to service_role;
revoke all on function public.classify_book_content_review(text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.classify_book_content_review(text,text,boolean,text) to service_role;
