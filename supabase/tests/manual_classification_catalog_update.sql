begin;
do $$
declare item record; tested integer:=0; j public.book_content_review_jobs; c public.public_ranking_catalog;
begin
  -- Use real approved image snapshots, but never commit the classification changes.
  for item in select b.isbn13,b.content_hash,r.cover_url from public.book_content_review_jobs b
    join public.reviewed_book_content r using(isbn13)
    where b.status='approved' and b.adult_only=false and r.enabled and r.cover_url is not null
    order by b.isbn13 limit 100
  loop
    if not public.classify_book_content_review(item.isbn13,item.content_hash,false,item.cover_url) then
      raise exception 'Classification with cover failed: %',item.isbn13;
    end if;
    if not public.classify_book_content_review(item.isbn13,item.content_hash,false,null) then
      raise exception 'Classification without cover failed: %',item.isbn13;
    end if;
    tested:=tested+1;
  end loop;
  if tested<>100 then raise exception 'Expected 100 records, got %',tested; end if;
  select * into c from public.public_ranking_catalog where enabled and adult_only=false limit 1;
  select * into j from public.book_content_review_jobs where isbn13=c.isbn;
  if j.isbn13 is null then raise exception 'Catalog fixture required'; end if;
  if public.classify_book_content_review(j.isbn13,'stale',false,null) then raise exception 'Stale edit accepted'; end if;
  if not public.classify_book_content_review(j.isbn13,j.content_hash,true,null) then raise exception 'Adult classification failed'; end if;
  if exists(select 1 from public.public_ranking_catalog where isbn=j.isbn13 and (enabled or adult_only is distinct from true)) then raise exception 'Adult ranking exclusion failed'; end if;
  if not public.classify_book_content_review(j.isbn13,j.content_hash,false,null) then raise exception 'General classification failed'; end if;
  if exists(select 1 from public.public_ranking_catalog where isbn=j.isbn13 and enabled) then raise exception 'General classification auto-published ranking'; end if;
  if (select classification_source from public.book_content_review_jobs where isbn13=j.isbn13) is distinct from 'manual' then raise exception 'Provenance lost'; end if;
  if has_function_privilege('anon','public.classify_book_content_review(text,text,boolean,text)','execute') or has_function_privilege('authenticated','public.classify_book_content_review(text,text,boolean,text)','execute') then raise exception 'Public write privilege'; end if;
end $$;
rollback;
select '100 classifications with covers and 100 without: passed; rollback complete' as result;
