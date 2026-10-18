begin;
do $$
declare lease uuid := gen_random_uuid(); r public.book_content_review_jobs; catalog_before text; catalog_after text;
begin
  select md5(coalesce(jsonb_agg(t order by ranking_key)::text,'')) into catalog_before from public.public_ranking_catalog t;
  insert into public.book_content_review_jobs(isbn13,status,lease_token) values('9799999999901','processing',lease),('9799999999902','processing',lease),('9799999999903','processing',lease);
  perform public.finish_book_content_review('9799999999901',lease,'{"status":"approved","adult_only":false,"cover_status":"approved","display":{"enabled":false,"source_url":"https://example.test/review"}}');
  select * into r from public.book_content_review_jobs where isbn13='9799999999901';
  assert r.adult_only=false and r.classification_source='ai' and r.status='approved','General classification not saved';
  perform public.finish_book_content_review('9799999999902',lease,'{"status":"rejected","adult_only":true,"cover_status":"held","display":{"enabled":false,"source_url":"https://example.test/review"}}');
  select * into r from public.book_content_review_jobs where isbn13='9799999999902';
  assert r.adult_only=true and r.cover_status='held','Adult classification not saved';
  perform public.finish_book_content_review('9799999999903',lease,'{"status":"pending_review","adult_only":null,"display":{"enabled":false,"source_url":"https://example.test/review"}}');
  select * into r from public.book_content_review_jobs where isbn13='9799999999903';
  assert r.adult_only is null and r.status='pending_review','Unknown must remain pending';
  update public.book_content_review_jobs set status='processing',lease_token=lease,adult_only=false,classification_source='manual' where isbn13='9799999999901';
  perform public.finish_book_content_review('9799999999901',lease,'{"status":"rejected","adult_only":true,"cover_status":"held"}');
  select * into r from public.book_content_review_jobs where isbn13='9799999999901';
  assert r.adult_only=false and r.classification_source='manual','Manual classification overwritten';
  update public.book_content_review_jobs set status='processing',lease_token=lease where isbn13='9799999999903';
  begin
    perform public.finish_book_content_review('9799999999903',lease,'{"status":"approved","adult_only":null,"display":{"enabled":true,"source_url":"https://example.test/review"}}');
    raise exception 'Unknown audience was allowed to publish';
  exception when raise_exception then
    if sqlerrm <> 'Audience not approved' then raise; end if;
  end;
  select md5(coalesce(jsonb_agg(t order by ranking_key)::text,'')) into catalog_after from public.public_ranking_catalog t;
  assert catalog_before=catalog_after,'AI changed ranking configuration';
  assert not has_function_privilege('anon','public.finish_book_content_review(text,uuid,jsonb)','execute'),'Anon can finish AI reviews';
  assert not has_function_privilege('authenticated','public.finish_book_content_review(text,uuid,jsonb)','execute'),'Public clients can finish AI reviews';
end $$;
rollback;
