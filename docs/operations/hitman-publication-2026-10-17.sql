-- Bind __TARGET_USER_ID__ to the audited account at execution time.
-- 講談社・瀬尾公治 ヒットマン: https://www.kodansha.co.jp/titles/1000032796
begin;
do $$
begin
  if (select count(*) from public.books where user_id='__TARGET_USER_ID__'::uuid and series_title='ヒットマン')<>13
    or not exists(select 1 from public.books where user_id='__TARGET_USER_ID__'::uuid and series_title='ヒットマン' and publisher='講談社' and author like '%瀬尾%') then
    raise exception 'Unexpected target series; aborting';
  end if;
  if exists(select 1 from public.series_metadata where user_id='__TARGET_USER_ID__'::uuid and series_key='ヒットマン') then
    raise exception 'Existing user override; review before changing';
  end if;
  insert into public.series_metadata(user_id,series_key,series_title,latest_volume,is_completed,publisher,source)
  values('__TARGET_USER_ID__'::uuid,'ヒットマン','ヒットマン',13,true,'講談社','manual');
end $$;
commit;
