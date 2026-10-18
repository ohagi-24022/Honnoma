-- Provider publication dates may contain only a year/month or an approximate date.
alter table public.notification_logs add column published_date text;
comment on column public.notification_logs.published_date is 'Publication date returned for the notified volume; null when unavailable. Not the notification timestamp.';
