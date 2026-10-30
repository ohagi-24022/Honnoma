-- Durable, finite bibliographic-price acquisition, separate from AI/content approval.
create table public.catalog_price_control (
 id boolean primary key default true check(id),enabled boolean not null default false,
 paused_until timestamptz,last_claimed_at timestamptz,last_wake_at timestamptz,
 started_at timestamptz,completed_at timestamptz
);
insert into public.catalog_price_control(id) values(true);
create table public.catalog_price_jobs (
 isbn13 text primary key check(isbn13 ~ '^(978|979)[0-9]{10}$'),title text not null,
 status text not null default 'queued' check(status in ('queued','processing','acquired','missing','retry','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,reason text,checked_at timestamptz
);
create index catalog_price_due_idx on public.catalog_price_jobs(status,available_at);
alter table public.catalog_price_control enable row level security;
alter table public.catalog_price_jobs enable row level security;
revoke all on public.catalog_price_control,public.catalog_price_jobs from public,anon,authenticated;
grant all on public.catalog_price_control,public.catalog_price_jobs to service_role;

create function public.start_catalog_price_acquisition() returns integer
language plpgsql security invoker set search_path='' as $$
declare added integer;
begin
 insert into public.catalog_price_jobs(isbn13,title,status,checked_at)
 select j.isbn13,coalesce(j.title,j.isbn13),
 case when k.list_price is not null or c.metadata->>'list_price' is not null then 'acquired' else 'queued' end,
 case when k.list_price is not null or c.metadata->>'list_price' is not null then now() end
 from public.book_content_review_jobs j
 left join public.book_metadata_cache k on k.normalized_isbn=j.isbn13
 left join public.confirmed_book_metadata c on c.normalized_isbn=j.isbn13 and c.enabled
 where j.review_requested and j.isbn13 ~ '^(978|979)[0-9]{10}$'
 on conflict(isbn13) do nothing;
 get diagnostics added=row_count;
 update public.catalog_price_control set enabled=true,paused_until=null,started_at=coalesce(started_at,now()),completed_at=null where id;
 return added;
end $$;

create function public.claim_catalog_price_jobs() returns setof public.catalog_price_jobs
language plpgsql security invoker set search_path='' as $$
declare cfg public.catalog_price_control; token uuid:=gen_random_uuid();
begin
 select * into cfg from public.catalog_price_control where id for update;
 if not cfg.enabled or cfg.paused_until>now() or cfg.last_claimed_at>now()-interval '50 seconds' then return; end if;
 if exists(select 1 from public.catalog_price_jobs where status='processing' and lease_until>now()) then return; end if;
 update public.catalog_price_jobs set status='failed',reason='再試行上限',lease_token=null,lease_until=null
 where status='processing' and lease_until<=now() and attempts>=3;
 if not exists(select 1 from public.catalog_price_jobs where status in ('queued','processing','retry')) then
  update public.catalog_price_control set enabled=false,completed_at=now() where id;return;
 end if;
 update public.catalog_price_control set last_claimed_at=now() where id;
 return query with chosen as (
  select isbn13 from public.catalog_price_jobs where attempts<3 and (
   (status in ('queued','retry') and available_at<=now()) or (status='processing' and lease_until<=now()))
  order by available_at,isbn13 for update skip locked limit 20
 ) update public.catalog_price_jobs j set status='processing',attempts=attempts+1,
 lease_token=token,lease_until=now()+interval '4 minutes',reason=null
 from chosen where j.isbn13=chosen.isbn13 returning j.*;
end $$;

create function public.finish_catalog_price_job(p_isbn text,p_lease uuid,p_result text,p_book jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare job public.catalog_price_jobs; price integer;
begin
 select * into job from public.catalog_price_jobs where isbn13=p_isbn and status='processing'
  and lease_token=p_lease and lease_until>now() for update;
 if not found then return false; end if;
 if p_result='acquired' then
  if p_book->>'isbn' is distinct from p_isbn or nullif(btrim(p_book->>'title'),'') is null then raise exception 'ISBN mismatch'; end if;
  price := (p_book->>'price')::integer;
  if price is null or price<=0 or price>1000000 then raise exception 'Invalid price';end if;
  -- Only provider bibliographic fields enter the cache. Never copy a personal shelf title.
  insert into public.book_metadata_cache(isbn,normalized_isbn,title,author,publisher,list_price,price_source,price_fetched_at,source,source_url)
  values(p_isbn,p_isbn,left(p_book->>'title',1000),left(p_book->>'author',1000),left(p_book->>'publisher',1000),price,'rakuten',now(),'Rakuten Books','https://books.rakuten.co.jp/search?sitem='||p_isbn)
  on conflict(normalized_isbn) where normalized_isbn is not null do nothing;
  perform public.fill_missing_book_retail_price(p_isbn,price);
 elsif p_result not in ('existing','missing','retry','rate_limit','deferred') then raise exception 'Invalid outcome';
 end if;
 update public.catalog_price_jobs set
 status=case when p_result in ('acquired','existing') then 'acquired' when p_result='missing' then 'missing'
  when p_result='deferred' then 'queued' when attempts>=3 then 'failed' else 'retry' end,
 attempts=case when p_result='deferred' then greatest(0,attempts-1) else attempts end,
 available_at=now()+case when p_result='rate_limit' then interval '10 minutes' when p_result='deferred' then interval '30 seconds' else interval '5 minutes' end,
 reason=case p_result when 'missing' then '取得先に価格なし' when 'retry' then '取得先との通信失敗' when 'rate_limit' then '取得先の利用制限' else null end,
 checked_at=case when p_result='deferred' then checked_at else now() end,lease_token=null,lease_until=null
 where isbn13=p_isbn;
 if p_result='rate_limit' then update public.catalog_price_control set paused_until=now()+interval '10 minutes' where id;end if;
 return true;
end $$;

-- Only the scheduler/server can dispatch to this one fixed private worker endpoint.
create function public.wake_catalog_price_acquisition() returns void
language plpgsql security definer set search_path='' as $$
declare cfg public.catalog_price_control; worker public.book_content_review_config;
begin
 select * into cfg from public.catalog_price_control where id for update;
 if not cfg.enabled or cfg.paused_until>now() or cfg.last_wake_at>now()-interval '50 seconds' then return;end if;
 if exists(select 1 from public.catalog_price_jobs where status='processing' and lease_until>now()) then return;end if;
 if not exists(select 1 from public.catalog_price_jobs where status in ('queued','retry','processing')) then
  update public.catalog_price_control set enabled=false,completed_at=now() where id;return;
 end if;
 if not exists(select 1 from public.catalog_price_jobs where (status in ('queued','retry') and available_at<=now()) or(status='processing' and lease_until<=now())) then return;end if;
 select * into worker from public.book_content_review_config where id;
 if worker.worker_url is distinct from 'https://shushukaadmin.onrender.com/api/content-review-worker' then return;end if;
 update public.catalog_price_control set last_wake_at=now() where id;
 perform net.http_post(url:=worker.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker.worker_token),
 body:='{"action":"run-catalog-retail-prices"}'::jsonb,timeout_milliseconds:=180000);
end $$;

revoke all on function public.start_catalog_price_acquisition(),public.claim_catalog_price_jobs(),public.finish_catalog_price_job(text,uuid,text,jsonb),public.wake_catalog_price_acquisition() from public,anon,authenticated;
grant execute on function public.start_catalog_price_acquisition(),public.claim_catalog_price_jobs(),public.finish_catalog_price_job(text,uuid,text,jsonb),public.wake_catalog_price_acquisition() to service_role;
select cron.schedule('honnoma-catalog-retail-prices','* * * * *','select public.wake_catalog_price_acquisition()');
