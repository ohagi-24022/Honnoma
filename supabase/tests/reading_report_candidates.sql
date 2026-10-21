begin;
do $$
declare target record; uid uuid; reading_key text; total integer;
begin
  if has_function_privilege('anon','public.get_series_reading_report_candidates(integer)','execute') then raise exception 'Anonymous access'; end if;
  if not has_function_privilege('authenticated','public.get_series_reading_report_candidates(integer)','execute') then raise exception 'Signed-in access missing'; end if;
  select id into uid from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  select count(*) into total from public.get_series_reading_report_candidates(999);
  if total<>20 then raise exception 'Expected bounded candidate pool'; end if;
  if exists(select 1 from public.get_series_reading_report_candidates(20) where report_count<>0) then raise exception 'Unreported works must take priority in this fixture'; end if;
  select * into target from public.get_series_reading_report_candidates(1);
  reading_key:=replace(translate(lower(normalize(target.series_title,NFKC)),E' 　・･:：-–—_\'"“”‘’()[]{}「」『』【】〈〉《》!?！？。.．',''),'僕モブを','僕を');
  insert into public.series_reading_suggestions(user_id,series_key,series_title,suggested_reading)
    values(uid,reading_key,target.series_title,'てすと') on conflict(user_id,series_key) do nothing;
  if exists(select 1 from public.get_series_reading_report_candidates(20) where series_title=target.series_title) then raise exception 'Own report offered again'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  if exists(select 1 from public.get_series_reading_report_candidates(20)) then raise exception 'Unauthenticated caller received candidates'; end if;
end $$;
rollback;
select 'reading candidates: limit, low-report priority, own-report exclusion and authentication passed; rollback complete' as result;
