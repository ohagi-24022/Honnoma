create table public.api_limit_mail_alerts (
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('wishlist_search','content_review')),
 kind text not null check(kind in ('rate_limit','quota','daily_limit')),
 day date not null default (now() at time zone 'UTC')::date,
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,
 sent_at timestamptz,
 unique(source,kind,day)
);
alter table public.api_limit_mail_alerts enable row level security;
revoke all on public.api_limit_mail_alerts from public,anon,authenticated;
grant select,insert,update on public.api_limit_mail_alerts to service_role;
create function public.enqueue_api_limit_mail(p_source text,p_kind text) returns void
language sql security definer set search_path='' as $$
 insert into public.api_limit_mail_alerts(source,kind) values(p_source,p_kind)
 on conflict(source,kind,day) do nothing;
$$;
create function public.claim_api_limit_mail() returns setof public.api_limit_mail_alerts
language sql security definer set search_path='' as $$
 update public.api_limit_mail_alerts a set status='sending',attempts=a.attempts+1,
 lease_token=gen_random_uuid(),available_at=now()+interval '5 minutes'
 where a.id=(select id from public.api_limit_mail_alerts
 where status in ('pending','sending') and available_at<=now() and attempts<5
 order by created_at for update skip locked limit 1) returning a.*;
$$;
create function public.finish_api_limit_mail(p_id uuid,p_lease uuid,p_sent boolean) returns void
language sql security definer set search_path='' as $$
 update public.api_limit_mail_alerts set
 status=case when p_sent then 'sent' when attempts>=5 then 'failed' else 'pending' end,
 sent_at=case when p_sent then now() else null end,
 available_at=now()+interval '15 minutes',lease_token=null
 where id=p_id and lease_token=p_lease and status='sending';
$$;
revoke all on function public.enqueue_api_limit_mail(text,text),public.claim_api_limit_mail(),public.finish_api_limit_mail(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_api_limit_mail(text,text),public.claim_api_limit_mail(),public.finish_api_limit_mail(uuid,uuid,boolean) to service_role;

-- Bibliographic preparation is independent of paid AI assessment. Wake only
-- when unprepared intake is due; preserve the existing AI budget and mail gate.
create or replace function public.wake_book_content_review() returns void
language plpgsql security definer set search_path='' as $$
declare c public.book_content_review_config; preparation_due boolean; ai_due boolean; alert_due boolean;
begin
 select * into c from public.book_content_review_config where id for update;
 if not found or c.last_wake_at > now()-interval '45 seconds' then return; end if;
 select exists(select 1 from public.book_content_review_jobs where status in ('queued','retry')
  and candidate->>'title' is null and adult_only is null and available_at<=now()) into preparation_due;
 ai_due := c.enabled and (
  exists(select 1 from public.book_content_review_jobs where
    ((status in ('queued','retry') and available_at<=now()) or (status='processing' and lease_until<now()))
    and (c.budget_day is distinct from current_date or c.attempts_today<c.daily_limit))
  or exists(select 1 from public.book_content_review_mail where
    ((status='pending' and available_at<=now()) or (status='sending' and lease_until<now()))
    and (c.last_mail_at is null or c.last_mail_at<now()-interval '15 minutes')));
 select exists(select 1 from public.api_limit_mail_alerts where status in ('pending','sending') and available_at<=now() and attempts<5) into alert_due;
 if not preparation_due and not ai_due and not alert_due then return; end if;
 update public.book_content_review_config set last_wake_at=now() where id;
 perform net.http_post(url:=c.worker_url,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||c.worker_token),
  body:=case when ai_due then '{}'::jsonb when preparation_due then '{"action":"prepare-pending"}'::jsonb else '{"action":"flush-alerts"}'::jsonb end,
  timeout_milliseconds:=180000);
end $$;
revoke all on function public.wake_book_content_review() from public,anon,authenticated;
grant execute on function public.wake_book_content_review() to service_role;
