create index wishlist_ai_search_created_idx on public.wishlist_ai_search_cache(created_at);
create or replace function public.claim_wishlist_ai_search(p_hash text,p_user uuid)
returns text language plpgsql security definer set search_path='' as $$
declare used integer; today date:=(now() at time zone 'UTC')::date;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_user is null then return 'invalid'; end if;
 -- Serialize claims across instances; completed/failed requests never call the AI again.
 perform pg_catalog.pg_advisory_xact_lock(823701205);
 if exists(select 1 from public.wishlist_ai_search_cache where query_hash=p_hash) then return 'cached'; end if;
 select count(*) into used from public.wishlist_ai_search_cache where created_at >= (today::timestamp at time zone 'UTC');
 if used>=100 then return 'limited'; end if;
 select calls into used from public.wishlist_ai_search_usage where user_id=p_user and day=today;
 if coalesce(used,0)>=10 then return 'limited'; end if;
 insert into public.wishlist_ai_search_usage(user_id,day,calls) values(p_user,today,1)
 on conflict(user_id,day) do update set calls=wishlist_ai_search_usage.calls+1;
 insert into public.wishlist_ai_search_cache(query_hash) values(p_hash);
 return 'claimed';
end $$;
revoke all on function public.claim_wishlist_ai_search(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_wishlist_ai_search(text,uuid) to service_role;
