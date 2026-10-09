-- Cover permission is independent of classification and approved description text.
create function public.set_book_cover_review(p_isbn text,p_hash text,p_show boolean,p_cover text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.book_content_review_jobs;
begin
  select * into j from public.book_content_review_jobs where isbn13=p_isbn for update;
  if not found or j.content_hash is distinct from p_hash or j.candidate is null or p_show is null then return false; end if;
  if p_show then
    if j.adult_only is distinct from false then return false; end if;
    if p_cover is null or p_cover !~ '^https://ccaregwftbjqwaztvwdu\.supabase\.co/storage/v1/object/public/reviewed-book-covers/[0-9a-f]{64}\.(jpeg|png|webp)$' then
      raise exception 'Invalid cover snapshot';
    end if;
    insert into public.reviewed_book_content(isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
      values(p_isbn,p_cover,null,j.candidate->>'source_url',true,'manual',p_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,enabled=true,review_source='manual',
      content_hash=excluded.content_hash,reviewed_at=now();
  else
    -- Leave approved text intact; a hidden cover must not hide the description.
    insert into public.reviewed_book_content(isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
      values(p_isbn,null,null,j.candidate->>'source_url',false,'manual',p_hash)
    on conflict(isbn13) do update set cover_url=null,
      enabled=reviewed_book_content.description is not null and j.adult_only is distinct from true,
      review_source='manual',reviewed_at=now();
  end if;
  update public.book_content_review_jobs set cover_status=case when p_show then 'approved' else 'held' end,
    status=case when j.adult_only then 'rejected' when p_show or description_status='approved' then 'approved' else 'pending_review' end,
    reason=case when p_show then '管理者が表紙を表示可に設定' else '管理者が表紙を非表示に設定' end,
    lease_token=null,lease_until=null,checked_at=now(),updated_at=now() where isbn13=p_isbn;
  update public.book_content_review_mail set status='cancelled' where isbn13=p_isbn and status in ('pending','sending');
  return true;
end $$;
revoke all on function public.set_book_cover_review(text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.set_book_cover_review(text,text,boolean,text) to service_role;
