-- Exercise ownership and delivery-column restrictions without leaving changes.
begin;
create temporary table inbox_archive_test as
select id,user_id,status,archived_at from public.notification_logs limit 1;
grant select on inbox_archive_test to authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from inbox_archive_test),true);
set local role authenticated;
do $$
declare affected integer;
begin
  update public.notification_logs set archived_at=now() where id=(select id from inbox_archive_test);
  get diagnostics affected=row_count;
  if affected <> 1 then raise exception 'Owner could not mark notification seen'; end if;
  if not exists(select 1 from public.notification_logs where id=(select id from inbox_archive_test) and archived_at is not null) then
    raise exception 'History entry was not preserved';
  end if;
  begin
    update public.notification_logs set status='failed' where id=(select id from inbox_archive_test);
    raise exception 'Delivery status was writable by client';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$
declare affected integer;
begin
  update public.notification_logs set archived_at=null where id=(select id from inbox_archive_test);
  get diagnostics affected=row_count;
  if affected <> 0 then raise exception 'Other user changed the notification'; end if;
end;
$$;
reset role;
do $$
begin
  if exists(select 1 from public.notification_logs n join inbox_archive_test t using(id) where n.status is distinct from t.status) then
    raise exception 'Reading changed delivery state';
  end if;
end;
$$;
rollback;
select 'Owner read state, preserved history, cross-user denial, delivery protection passed; all changes rolled back' as result;
