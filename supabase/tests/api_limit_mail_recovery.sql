begin;
do $$
declare first_id uuid; active integer; total integer;
begin
 if has_function_privilege('anon','public.recover_api_limit_mail(text,text,timestamptz)','execute') or has_function_privilege('authenticated','public.recover_api_limit_mail(text,text,timestamptz)','execute') then raise exception 'Public recovery access'; end if;
 perform public.enqueue_api_limit_mail('content_review','quota');
 select id into first_id from public.api_limit_mail_alerts where source='content_review' and kind='quota' and recovered_at is null and day=(now() at time zone 'UTC')::date;
 update public.api_limit_mail_alerts set status='sent',sent_at=now() where id=first_id;
 perform public.recover_api_limit_mail('content_review','quota',now()-interval '1 minute');
 if (select recovered_at from public.api_limit_mail_alerts where id=first_id) is not null then raise exception 'Earlier in-flight request incorrectly recovered incident'; end if;
 perform public.enqueue_api_limit_mail('content_review','quota');
 select count(*) into total from public.api_limit_mail_alerts where source='content_review' and kind='quota' and day=(now() at time zone 'UTC')::date;
 if total<>1 then raise exception 'Ongoing incident duplicated'; end if;
 perform public.recover_api_limit_mail('content_review','rate_limit',now());
 if (select recovered_at from public.api_limit_mail_alerts where id=first_id) is not null then raise exception 'Different cause recovered'; end if;
 perform public.recover_api_limit_mail('content_review','quota',now());
 perform public.enqueue_api_limit_mail('content_review','quota');
 perform public.enqueue_api_limit_mail('content_review','quota');
 select count(*),count(*) filter(where recovered_at is null) into total,active from public.api_limit_mail_alerts where source='content_review' and kind='quota' and day=(now() at time zone 'UTC')::date;
 if total<>2 or active<>1 then raise exception 'Same-day recurrence missing or duplicated'; end if;
 if (select status from public.api_limit_mail_alerts where id=first_id)<>'sent' then raise exception 'Prior mail history lost'; end if;
end $$;
select 'Same-day recurrence, active-incident deduplication, prior history, source/cause scoping and in-flight request order: OK' as result;
rollback;
