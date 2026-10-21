-- Keep prior mail history; a new incident after confirmed recovery gets a new ID.
alter table public.api_limit_mail_alerts add column recovered_at timestamptz;
alter table public.api_limit_mail_alerts drop constraint api_limit_mail_alerts_source_kind_day_key;
create unique index api_limit_mail_active_day_idx on public.api_limit_mail_alerts(source,kind,day) where recovered_at is null;
create or replace function public.enqueue_api_limit_mail(p_source text,p_kind text) returns void
language sql security definer set search_path='' as $$
 insert into public.api_limit_mail_alerts(source,kind) values(p_source,p_kind)
 on conflict(source,kind,day) where recovered_at is null do nothing;
$$;
create function public.recover_api_limit_mail(p_source text,p_kind text,p_request_started_at timestamptz) returns void
language sql security definer set search_path='' as $$
 -- A successful request started before the incident is not proof of recovery.
 update public.api_limit_mail_alerts set recovered_at=now()
 where source=p_source and kind=p_kind and recovered_at is null and created_at<=p_request_started_at;
$$;
revoke all on function public.recover_api_limit_mail(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.recover_api_limit_mail(text,text,timestamptz) to service_role;
