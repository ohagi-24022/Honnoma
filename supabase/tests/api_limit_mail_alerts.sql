begin;
do $$
declare a public.api_limit_mail_alerts; b public.api_limit_mail_alerts; original_lease uuid; n integer;
begin
 if has_table_privilege('anon','public.api_limit_mail_alerts','select') or has_table_privilege('authenticated','public.api_limit_mail_alerts','select') then raise exception 'Client table access'; end if;
 if has_function_privilege('authenticated','public.enqueue_api_limit_mail(text,text)','execute') or has_function_privilege('anon','public.claim_api_limit_mail()','execute') then raise exception 'Client RPC access'; end if;
 if not has_function_privilege('service_role','public.claim_api_limit_mail()','execute') then raise exception 'Worker access missing'; end if;
 perform public.enqueue_api_limit_mail('wishlist_search','quota');
 perform public.enqueue_api_limit_mail('wishlist_search','quota');
 select count(*) into n from public.api_limit_mail_alerts where source='wishlist_search' and kind='quota' and day=(now() at time zone 'UTC')::date;
 if n<>1 then raise exception 'Duplicate alert'; end if;
 -- All writes and leases are rolled back; no worker is invoked by this test.
 update public.api_limit_mail_alerts set created_at='1900-01-01',available_at=now()-interval '1 minute' where source='wishlist_search' and kind='quota' and day=(now() at time zone 'UTC')::date;
 select * into a from public.claim_api_limit_mail();
 if a.source<>'wishlist_search' or a.kind<>'quota' or a.attempts<>1 or a.status<>'sending' then raise exception 'Bad claim'; end if;
 original_lease:=a.lease_token;
 select * into b from public.claim_api_limit_mail();
 if b.id=a.id then raise exception 'Duplicate live lease'; end if;
 perform public.finish_api_limit_mail(a.id,gen_random_uuid(),true);
 if (select status from public.api_limit_mail_alerts where id=a.id)<>'sending' then raise exception 'Wrong lease accepted'; end if;
 perform public.finish_api_limit_mail(a.id,a.lease_token,false);
 if (select status from public.api_limit_mail_alerts where id=a.id)<>'pending' then raise exception 'Failed mail not queued'; end if;
 if (select available_at from public.api_limit_mail_alerts where id=a.id)<=now() then raise exception 'Missing retry delay'; end if;
 update public.api_limit_mail_alerts set available_at=now()-interval '1 minute' where id=a.id;
 select * into a from public.claim_api_limit_mail();
 if a.attempts<>2 or a.lease_token=original_lease then raise exception 'Bad retry lease'; end if;
 perform public.finish_api_limit_mail(a.id,a.lease_token,true);
 perform public.enqueue_api_limit_mail('wishlist_search','quota');
 if (select status from public.api_limit_mail_alerts where id=a.id)<>'sent' then raise exception 'Sent alert requeued'; end if;
end $$;
select 'API limit mail: access, deduplication, exclusive lease, lease validation, retry delay and sent preservation OK' as result;
rollback;
