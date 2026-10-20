-- Bibliographic preparation is independent of paid AI assessment. Wake only
-- when unprepared intake is due; preserve the existing AI budget and mail gate.
create or replace function public.wake_book_content_review() returns void
language plpgsql security definer set search_path='' as $$
declare c public.book_content_review_config; preparation_due boolean; ai_due boolean;
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
 if not preparation_due and not ai_due then return; end if;
 update public.book_content_review_config set last_wake_at=now() where id;
 perform net.http_post(url:=c.worker_url,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||c.worker_token),
  body:=case when ai_due then '{}'::jsonb else '{"action":"prepare-pending"}'::jsonb end,
  timeout_milliseconds:=180000);
end $$;
revoke all on function public.wake_book_content_review() from public,anon,authenticated;
grant execute on function public.wake_book_content_review() to service_role;
