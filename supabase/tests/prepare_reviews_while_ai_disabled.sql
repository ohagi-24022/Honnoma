-- The pg_net request is transactional: rolling back prevents any HTTP call.
begin;
update public.book_content_review_config set enabled=false,last_wake_at=null where id;
select public.wake_book_content_review();
do $$ begin
 if not exists(select 1 from net.http_request_queue q join public.book_content_review_config c on c.worker_url=q.url
  where convert_from(q.body,'UTF8')::jsonb->>'action'='prepare-pending') then
  raise exception 'AI-disabled wake must request metadata preparation only';
 end if;
end $$;
rollback;
