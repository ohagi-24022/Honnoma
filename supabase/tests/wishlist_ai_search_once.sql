begin;
do $$
declare uid uuid; other_uid uuid; result text; used integer;
begin
 select id into uid from auth.users order by created_at limit 1;
 select id into other_uid from auth.users where id<>uid order by created_at limit 1;
 if has_function_privilege('anon','public.claim_wishlist_ai_search(text,uuid)','execute') or has_function_privilege('authenticated','public.claim_wishlist_ai_search(text,uuid)','execute') then raise exception 'Client can claim paid usage'; end if;
 if has_table_privilege('authenticated','public.wishlist_ai_search_cache','select') then raise exception 'Client can enumerate searches'; end if;
 if public.claim_wishlist_ai_search(repeat('f',64),uid)<>'claimed' then raise exception 'Initial claim failed'; end if;
 if public.claim_wishlist_ai_search(repeat('f',64),other_uid)<>'cached' then raise exception 'Shared deduplication failed'; end if;
 update public.wishlist_ai_search_cache set status='failed' where query_hash=repeat('f',64);
 if public.claim_wishlist_ai_search(repeat('f',64),uid)<>'cached' then raise exception 'Failed requests can be charged twice'; end if;
 select calls into used from public.wishlist_ai_search_usage where user_id=uid and day=(now() at time zone 'UTC')::date;
 if used<>1 then raise exception 'Duplicate claim consumed budget'; end if;
 for n in 1..9 loop perform public.claim_wishlist_ai_search(lpad(n::text,64,'0'),uid); end loop;
 if public.claim_wishlist_ai_search(repeat('e',64),uid)<>'limited' then raise exception 'User cap failed'; end if;
 insert into public.wishlist_ai_search_cache(query_hash) select md5('budget-test-'||n)||md5('budget-test-'||n) from generate_series(1,100) n;
 delete from public.wishlist_ai_search_usage where user_id=uid;
 if public.claim_wishlist_ai_search(repeat('e',64),other_uid)<>'limited' then raise exception 'Global cap failed'; end if;
end $$;
rollback;
select 'search claim: shared deduplication, failed-call deduplication, per-user/global caps, restricted grants passed; rollback complete' as result;
