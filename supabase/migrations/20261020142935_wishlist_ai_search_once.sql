create table public.wishlist_ai_search_cache (
 query_hash text primary key check(query_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'processing' check(status in ('processing','completed','failed')),
 queries jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 input_tokens integer not null default 0,
 output_tokens integer not null default 0
);
create table public.wishlist_ai_search_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null default (now() at time zone 'UTC')::date,
 calls integer not null default 0,
 primary key(user_id,day)
);
alter table public.wishlist_ai_search_cache enable row level security;
alter table public.wishlist_ai_search_usage enable row level security;
revoke all on public.wishlist_ai_search_cache,public.wishlist_ai_search_usage from public,anon,authenticated;
grant select,insert,update on public.wishlist_ai_search_cache to service_role;
grant select on public.wishlist_ai_search_usage to service_role;
create function public.claim_wishlist_ai_search(p_hash text,p_user uuid)
returns text language plpgsql security definer set search_path='' as $$
declare used integer; today date:=(now() at time zone 'UTC')::date;
begin
 if p_hash !~ '^[0-9a-f]{64}$' or p_user is null then return 'invalid'; end if;
 -- Serialize claims across instances; completed/failed requests never call the AI again.
 perform pg_catalog.pg_advisory_xact_lock(823701205);
 if exists(select 1 from public.wishlist_ai_search_cache where query_hash=p_hash) then return 'cached'; end if;
 select coalesce(sum(calls),0) into used from public.wishlist_ai_search_usage where day=today;
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
