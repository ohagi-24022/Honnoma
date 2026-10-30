begin;
set local role service_role;
select public.start_catalog_price_acquisition();
create temporary table catalog_price_claim_test as select * from public.claim_catalog_price_jobs();
do $$
declare j public.catalog_price_jobs; n integer; i integer:=0;
begin
 select count(*) into n from catalog_price_claim_test;
 if n<>20 then raise exception 'Batch must be bounded to 20: %',n;end if;
 if exists(select 1 from public.claim_catalog_price_jobs()) then raise exception 'Parallel batch claim allowed';end if;
 for j in select * from catalog_price_claim_test order by isbn13 limit 4 loop
  i:=i+1;
  if public.finish_catalog_price_job(j.isbn13,gen_random_uuid(),'missing') then raise exception 'Stale lease accepted';end if;
  if i=1 then
   perform public.finish_catalog_price_job(j.isbn13,j.lease_token,'acquired',jsonb_build_object('isbn',j.isbn13,'title','取得検証','price',550));
   if not exists(select 1 from public.book_metadata_cache where normalized_isbn=j.isbn13 and list_price=550) then raise exception 'Catalog save failed';end if;
  elsif i=2 then
   perform public.finish_catalog_price_job(j.isbn13,j.lease_token,'rate_limit');
   if not exists(select 1 from public.catalog_price_control where id and paused_until>now()+interval '9 minutes') then raise exception 'Quota backoff failed';end if;
  elsif i=3 then
   perform public.finish_catalog_price_job(j.isbn13,j.lease_token,'deferred');
   if not exists(select 1 from public.catalog_price_jobs where isbn13=j.isbn13 and status='queued' and attempts=0) then raise exception 'Unattempted job consumed retry';end if;
  else
   update public.catalog_price_jobs set attempts=3 where isbn13=j.isbn13;
   perform public.finish_catalog_price_job(j.isbn13,j.lease_token,'retry');
   if not exists(select 1 from public.catalog_price_jobs where isbn13=j.isbn13 and status='failed') then raise exception 'Retry cap failed';end if;
  end if;
 end loop;
 update public.catalog_price_control set enabled=false where id;
 if exists(select 1 from public.claim_catalog_price_jobs()) then raise exception 'Pause ignored';end if;
end $$;
reset role;
do $$begin
 if has_table_privilege('anon','public.catalog_price_jobs','SELECT')
 or has_function_privilege('authenticated','public.start_catalog_price_acquisition()','EXECUTE')
 or has_function_privilege('anon','public.wake_catalog_price_acquisition()','EXECUTE') then raise exception 'Client control access';end if;
end$$;
select 'Catalog role, persistence, exclusive leases, pause, bounded retries, quota backoff and client isolation: passed' as verification;
rollback;
