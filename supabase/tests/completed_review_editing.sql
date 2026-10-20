begin;
do $$
declare j public.book_content_review_jobs; r public.reviewed_book_content; payload jsonb; original_adult boolean; original_ranking jsonb;
begin
  select * into j from public.book_content_review_jobs where status='approved' and adult_only=false and candidate->>'cover_hash' is not null limit 1;
  if not found then raise exception 'Approved review fixture required'; end if;
  select * into r from public.reviewed_book_content where isbn13=j.isbn13;
  original_adult:=j.adult_only;
  select jsonb_agg(to_jsonb(c)) into original_ranking from public.public_ranking_catalog c where isbn=j.isbn13;
  payload:=jsonb_build_object('cover_url',r.cover_url,'description',null,'source_url',j.candidate->>'source_url');
  if not public.resolve_book_content_review(j.isbn13,j.content_hash,payload,true) then raise exception 'Completed approval failed'; end if;
  if (select description is not null from public.reviewed_book_content where isbn13=j.isbn13) then raise exception 'Unchecked description retained'; end if;
  if (select cover_status<>'approved' or description_status<>'held' from public.book_content_review_jobs where isbn13=j.isbn13) then raise exception 'Flags not synchronized'; end if;
  if public.resolve_book_content_review(j.isbn13,'stale',payload,false) then raise exception 'Stale edit accepted'; end if;
  if public.resolve_book_content_review(j.isbn13,j.content_hash,payload||'{"cover_url":"https://example.test/unverified.jpg"}',true) then raise exception 'Unverified image accepted'; end if;
  if public.resolve_book_content_review(j.isbn13,j.content_hash,payload||'{"description":"unverified"}',true) then raise exception 'Changed text accepted'; end if;
  if not public.resolve_book_content_review(j.isbn13,j.content_hash,jsonb_build_object('source_url',j.candidate->>'source_url'),false) then raise exception 'Completed hide failed'; end if;
  if (select enabled or cover_url is not null or description is not null from public.reviewed_book_content where isbn13=j.isbn13) then raise exception 'Hide incomplete'; end if;
  if not public.resolve_book_content_review(j.isbn13,j.content_hash,payload,true) then raise exception 'Reapproval failed'; end if;
  update public.book_content_review_jobs set adult_only=true where isbn13=j.isbn13;
  if public.resolve_book_content_review(j.isbn13,j.content_hash,payload,true) then raise exception 'Adult approval accepted'; end if;
  update public.book_content_review_jobs set adult_only=original_adult,status='processing' where isbn13=j.isbn13;
  if public.resolve_book_content_review(j.isbn13,j.content_hash,payload,true) then raise exception 'Processing edit accepted'; end if;
  if original_ranking is distinct from (select jsonb_agg(to_jsonb(c)) from public.public_ranking_catalog c where isbn=j.isbn13) then raise exception 'Ranking settings changed'; end if;
  if has_function_privilege('anon','public.resolve_book_content_review(text,text,jsonb,boolean)','execute') or has_function_privilege('authenticated','public.resolve_book_content_review(text,text,jsonb,boolean)','execute') then raise exception 'Public approval privilege'; end if;
end $$;
rollback;
select 'completed review editing: rollback checks passed' as result;
