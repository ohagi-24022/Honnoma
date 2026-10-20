-- Administrators may revise a completed review without resetting its classification.
create or replace function public.resolve_book_content_review(
  p_isbn text, p_hash text, p_display jsonb, p_approved boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.book_content_review_jobs;
begin
  select * into j from public.book_content_review_jobs
    where isbn13=p_isbn and content_hash=p_hash
      and status in ('pending_review','approved','rejected') for update;
  if not found or p_approved is null then return false; end if;
  if p_approved then
    if j.adult_only is true or (j.status <> 'pending_review' and j.adult_only is distinct from false) then return false; end if;
    if coalesce(p_display->>'cover_url','')='' and coalesce(p_display->>'description','')='' then return false; end if;
    if p_display->>'cover_url' is not null and (j.candidate->>'cover_hash' is null or
      p_display->>'cover_url' !~ '^https://ccaregwftbjqwaztvwdu\.supabase\.co/storage/v1/object/public/reviewed-book-covers/[0-9a-f]{64}\.(jpeg|png|webp)$') then return false; end if;
    if p_display->>'description' is not null and p_display->>'description' is distinct from j.candidate->>'description' then return false; end if;
  end if;
  insert into public.reviewed_book_content (isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
    values(p_isbn,case when p_approved then p_display->>'cover_url' end,
      case when p_approved then p_display->>'description' end,p_display->>'source_url',p_approved,'manual',p_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,description=excluded.description,source_url=excluded.source_url,
      enabled=excluded.enabled,review_source='manual',content_hash=p_hash,reviewed_at=now();
  update public.book_content_review_jobs set status=case when p_approved then 'approved' else 'rejected' end,
    cover_status=case when p_approved and p_display->>'cover_url' is not null then 'approved' else 'held' end,
    description_status=case when p_approved and p_display->>'description' is not null then 'approved' else 'held' end,
    lease_token=null,lease_until=null,checked_at=now(),updated_at=now(),reason='管理者が表示設定を確認'
    where isbn13=p_isbn;
  update public.book_content_review_mail set status='cancelled' where isbn13=p_isbn and status in ('pending','sending');
  return true;
end $$;
revoke all on function public.resolve_book_content_review(text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.resolve_book_content_review(text,text,jsonb,boolean) to service_role;
