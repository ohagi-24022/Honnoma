-- Run this in the Supabase SQL editor after storing these Vault secrets:
--
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
-- select vault.create_secret('YOUR_SUPABASE_SERVICE_ROLE_KEY', 'function_key');
--
-- `function_key` must be the service role key. The Edge Function rejects normal
-- authenticated user requests. If you configure CHECK_NEW_RELEASES_SECRET in
-- Supabase secrets, you can also send it as `x-honnoma-cron-secret` from a
-- trusted scheduler instead of using this SQL cron example.
--
-- Supabase scheduled functions use pg_cron + pg_net to call Edge Functions.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Supabase cron runs in UTC. The examples below target Japan time:
-- 11:30 JST = 02:30 UTC, 12:00 JST = 03:00 UTC.

select cron.schedule(
  'honnoma-check-new-releases-at-1130-jst',
  '30 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'function_key')
    ),
    body := jsonb_build_object('mode', 'check', 'limit', 30)
  );
  $$
);

select cron.schedule(
  'honnoma-deliver-new-release-notifications-at-1200-jst',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'function_key')
    ),
    body := jsonb_build_object('mode', 'deliver', 'userLimit', 100)
  );
  $$
);
