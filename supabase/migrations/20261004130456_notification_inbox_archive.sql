alter table public.notification_logs add column if not exists archived_at timestamptz;

-- Clients can change only their own inbox state, never the delivery status.
grant update (archived_at) on public.notification_logs to authenticated;
create policy "Users can mark their own notifications seen"
  on public.notification_logs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists notification_logs_inbox_idx
  on public.notification_logs(user_id, created_at desc) where archived_at is null;
