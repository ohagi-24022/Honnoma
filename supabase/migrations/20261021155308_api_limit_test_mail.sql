-- Mark delivery tests explicitly; recovered test records do not consume the
-- partial unique key used to suppress ongoing production incidents.
alter table public.api_limit_mail_alerts add column is_test boolean not null default false;
