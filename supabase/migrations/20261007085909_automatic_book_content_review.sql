-- Only server-fetched bibliographic content enters this queue; clients submit ISBNs only.
create table public.book_content_review_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  worker_url text not null default 'https://shushukaadmin.onrender.com/api/content-review-worker'
    check (worker_url = 'https://shushukaadmin.onrender.com/api/content-review-worker'),
  worker_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  daily_limit integer not null default 50 check (daily_limit between 1 and 500),
  budget_day date,
  attempts_today integer not null default 0,
  last_wake_at timestamptz,
  last_mail_at timestamptz
);
insert into public.book_content_review_config (id) values (true);

create table public.book_content_review_jobs (
  isbn13 text primary key check (isbn13 ~ '^(978|979)[0-9]{10}$'),
  status text not null default 'queued' check (status in ('queued','processing','retry','pending_review','approved','rejected')),
  content_hash text,
  title text,
  candidate jsonb,
  assessment jsonb,
  cover_status text not null default 'unreviewed' check (cover_status in ('unreviewed','approved','held','absent')),
  description_status text not null default 'unreviewed' check (description_status in ('unreviewed','approved','held','absent')),
  reason text,
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index book_content_review_jobs_due_idx on public.book_content_review_jobs (available_at)
  where status in ('queued','retry','processing');
create index book_content_review_jobs_created_idx on public.book_content_review_jobs (created_at);
create index book_content_review_jobs_pending_idx on public.book_content_review_jobs (updated_at)
  where status = 'pending_review';

create table public.book_content_review_mail (
  id uuid primary key default gen_random_uuid(),
  isbn13 text not null references public.book_content_review_jobs(isbn13) on delete cascade,
  content_hash text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','cancelled','failed')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (isbn13, content_hash)
);
create index book_content_review_mail_due_idx on public.book_content_review_mail (available_at)
  where status in ('pending','sending');
alter table public.reviewed_book_content add column review_source text not null default 'manual'
  check (review_source in ('manual','ai'));
alter table public.reviewed_book_content add column content_hash text;

alter table public.book_content_review_config enable row level security;
alter table public.book_content_review_jobs enable row level security;
alter table public.book_content_review_mail enable row level security;
revoke all on public.book_content_review_config, public.book_content_review_jobs, public.book_content_review_mail from public, anon, authenticated;
grant all on public.book_content_review_config, public.book_content_review_jobs, public.book_content_review_mail to service_role;

create function public.enqueue_book_content_reviews(p_isbns text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_isbn text; v_count integer := 0; v_changed integer;
begin
  -- Global queue intake bound protects the unauthenticated ISBN-only endpoint.
  perform pg_advisory_xact_lock(706071);
  for v_isbn in select distinct x from unnest(p_isbns[1:20]) x loop
    if v_isbn !~ '^(978|979)[0-9]{10}$' then continue; end if;
    if (select count(*) from public.book_content_review_jobs where created_at >= current_date) >= 1000 then exit; end if;
    insert into public.book_content_review_jobs (isbn13) values (v_isbn)
    on conflict (isbn13) do update set status='queued', attempts=0, available_at=now(), updated_at=now()
      where book_content_review_jobs.status in ('approved','rejected')
        and book_content_review_jobs.checked_at < now() - interval '30 days';
    get diagnostics v_changed = row_count;
    v_count := v_count + v_changed;
  end loop;
  if v_count > 0 then perform public.wake_book_content_review(); end if;
  return v_count;
end $$;

create function public.queue_registered_book_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_isbn text;
begin
  v_isbn := case when tg_table_name = 'book_metadata_cache' then coalesce(to_jsonb(new)->>'normalized_isbn',to_jsonb(new)->>'isbn') else to_jsonb(new)->>'isbn' end;
  perform public.enqueue_book_content_reviews(array[regexp_replace(coalesce(v_isbn,''),'[^0-9]','','g')]);
  return new;
end $$;
create trigger queue_book_content_on_book after insert or update of isbn on public.books
  for each row execute function public.queue_registered_book_content();
create trigger queue_book_content_on_metadata after insert or update of normalized_isbn, isbn on public.book_metadata_cache
  for each row execute function public.queue_registered_book_content();

create function public.claim_book_content_review() returns setof public.book_content_review_jobs
language plpgsql security definer set search_path = '' as $$
declare v_config public.book_content_review_config; v_isbn text;
begin
  select * into v_config from public.book_content_review_config where id for update;
  if not v_config.enabled then return; end if;
  if v_config.budget_day is distinct from current_date then
    update public.book_content_review_config set budget_day=current_date, attempts_today=0 where id;
    v_config.attempts_today := 0;
  end if;
  if v_config.attempts_today >= v_config.daily_limit then return; end if;
  select isbn13 into v_isbn from public.book_content_review_jobs
    where (status in ('queued','retry') and available_at <= now())
       or (status='processing' and lease_until < now())
    order by available_at for update skip locked limit 1;
  if v_isbn is null then return; end if;
  update public.book_content_review_config set attempts_today=attempts_today+1 where id;
  return query update public.book_content_review_jobs set status='processing', attempts=attempts+1,
    lease_token=gen_random_uuid(), lease_until=now()+interval '5 minutes', updated_at=now()
    where isbn13=v_isbn returning *;
end $$;

create function public.finish_book_content_review(p_isbn text, p_lease uuid, p_result jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_job public.book_content_review_jobs; v_status text; v_hash text;
begin
  select * into v_job from public.book_content_review_jobs where isbn13=p_isbn for update;
  if not found or v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease then return false; end if;
  v_status := p_result->>'status'; v_hash := coalesce(p_result->>'content_hash',v_job.content_hash,'unavailable');
  if v_status not in ('approved','pending_review','retry','rejected') then raise exception 'Invalid result status'; end if;
  -- A manual decision cannot be overwritten by a late automatic result.
  if exists(select 1 from public.reviewed_book_content where isbn13=p_isbn and review_source='manual') then
    update public.book_content_review_jobs set status=case when (select enabled from public.reviewed_book_content where isbn13=p_isbn) then 'approved' else 'rejected' end,
      lease_token=null, lease_until=null, checked_at=now(), updated_at=now() where isbn13=p_isbn;
    return true;
  end if;
  update public.book_content_review_jobs set status=v_status, content_hash=coalesce(v_hash,content_hash),
    title=coalesce(p_result->>'title',title), candidate=coalesce(p_result->'candidate',candidate),
    assessment=coalesce(p_result->'assessment',assessment),
    cover_status=coalesce(p_result->>'cover_status',cover_status), description_status=coalesce(p_result->>'description_status',description_status),
    reason=left(p_result->>'reason',500), lease_token=null, lease_until=null,
    checked_at=case when v_status='retry' then checked_at else now() end,
    available_at=now()+make_interval(mins=>least(240,5*(2^least(v_job.attempts,5))::integer)), updated_at=now()
    where isbn13=p_isbn;
  if v_status <> 'retry' and p_result ? 'display' then
    insert into public.reviewed_book_content (isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
    values (p_isbn,p_result->'display'->>'cover_url',p_result->'display'->>'description',p_result->'display'->>'source_url',
      coalesce((p_result->'display'->>'enabled')::boolean,false),'ai',v_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,description=excluded.description,source_url=excluded.source_url,
      enabled=excluded.enabled,review_source='ai',content_hash=excluded.content_hash,reviewed_at=now()
      where reviewed_book_content.review_source='ai';
  end if;
  if v_status='pending_review' then
    insert into public.book_content_review_mail (isbn13,content_hash) values(p_isbn,coalesce(v_hash,'unavailable'))
      on conflict(isbn13,content_hash) do nothing;
  end if;
  return true;
end $$;

create function public.claim_book_content_review_mail() returns setof public.book_content_review_mail
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz; v_token uuid := gen_random_uuid();
begin
  select last_mail_at into v_last from public.book_content_review_config where id and enabled for update;
  if not found or v_last > now()-interval '15 minutes' then return; end if;
  update public.book_content_review_mail m set status='cancelled'
    where m.status in ('pending','sending') and exists(select 1 from public.book_content_review_jobs j where j.isbn13=m.isbn13 and (j.status<>'pending_review' or j.content_hash is distinct from m.content_hash));
  if not exists(select 1 from public.book_content_review_mail where (status='pending' and available_at<=now()) or (status='sending' and lease_until<now())) then return; end if;
  update public.book_content_review_config set last_mail_at=now() where id;
  return query update public.book_content_review_mail set status='sending',lease_token=v_token,
    lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id in (select id from public.book_content_review_mail
      where (status='pending' and available_at<=now()) or (status='sending' and lease_until<now())
      order by created_at for update skip locked limit 20) returning *;
end $$;

create function public.finish_book_content_review_mail(p_ids uuid[], p_lease uuid, p_sent boolean) returns void
language sql security definer set search_path = '' as $$
  update public.book_content_review_mail set status=case when p_sent then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    sent_at=case when p_sent then now() else null end, lease_token=null,lease_until=null,available_at=now()+interval '15 minutes'
    where id=any(p_ids) and status='sending' and lease_token=p_lease;
$$;

create function public.resolve_book_content_review(p_isbn text, p_hash text, p_display jsonb, p_approved boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.book_content_review_jobs where isbn13=p_isbn and content_hash=p_hash and status='pending_review' for update;
  if not found then return false; end if;
  insert into public.reviewed_book_content (isbn13,cover_url,description,source_url,enabled,review_source,content_hash)
    values(p_isbn,p_display->>'cover_url',p_display->>'description',p_display->>'source_url',p_approved,'manual',p_hash)
    on conflict(isbn13) do update set cover_url=excluded.cover_url,description=excluded.description,source_url=excluded.source_url,
      enabled=excluded.enabled,review_source='manual',content_hash=p_hash,reviewed_at=now();
  update public.book_content_review_jobs set status=case when p_approved then 'approved' else 'rejected' end,
    lease_token=null,lease_until=null,checked_at=now(),updated_at=now(),reason='管理者が確認' where isbn13=p_isbn;
  update public.book_content_review_mail set status='cancelled' where isbn13=p_isbn and status='pending';
  return true;
end $$;

create function public.wake_book_content_review() returns void
language plpgsql security definer set search_path = '' as $$
declare c public.book_content_review_config;
begin
  select * into c from public.book_content_review_config where id and enabled for update;
  if not found or c.last_wake_at > now()-interval '45 seconds' then return; end if;
  if not exists(select 1 from public.book_content_review_jobs where ((status in ('queued','retry') and available_at<=now()) or (status='processing' and lease_until<now()))
      and (c.budget_day is distinct from current_date or c.attempts_today<c.daily_limit))
    and not exists(select 1 from public.book_content_review_mail where ((status='pending' and available_at<=now()) or (status='sending' and lease_until<now())) and (c.last_mail_at is null or c.last_mail_at<now()-interval '15 minutes')) then return; end if;
  update public.book_content_review_config set last_wake_at=now() where id;
  perform net.http_post(url:=c.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||c.worker_token),body:='{}'::jsonb,timeout_milliseconds:=180000);
end $$;
-- Cron retries only when work is due; it does not ping an idle/free Render service.
select cron.schedule('book-content-review-due','*/2 * * * *','select public.wake_book_content_review()');

revoke all on function public.enqueue_book_content_reviews(text[]), public.queue_registered_book_content(), public.claim_book_content_review(),
  public.finish_book_content_review(text,uuid,jsonb),public.claim_book_content_review_mail(),public.finish_book_content_review_mail(uuid[],uuid,boolean),
  public.resolve_book_content_review(text,text,jsonb,boolean),public.wake_book_content_review() from public, anon, authenticated;
grant execute on function public.enqueue_book_content_reviews(text[]),public.claim_book_content_review(),public.finish_book_content_review(text,uuid,jsonb),
  public.claim_book_content_review_mail(),public.finish_book_content_review_mail(uuid[],uuid,boolean),public.resolve_book_content_review(text,text,jsonb,boolean),
  public.wake_book_content_review() to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
  values ('reviewed-book-covers','reviewed-book-covers',true,8388608,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Public reads of approved cover snapshots; no client upload/update/delete policy.
create policy "Read reviewed cover snapshots" on storage.objects for select to anon,authenticated
  using (bucket_id='reviewed-book-covers');

-- Backfill ISBNs only, never users' notes or identities. Activation still requires server keys.
insert into public.book_content_review_jobs(isbn13)
select distinct isbn from (select regexp_replace(isbn,'[^0-9]','','g') isbn from public.books
  union select regexp_replace(coalesce(normalized_isbn,isbn),'[^0-9]','','g') from public.book_metadata_cache
  union select isbn from public.public_ranking_catalog) s where isbn ~ '^(978|979)[0-9]{10}$'
  limit 1000 on conflict do nothing;
