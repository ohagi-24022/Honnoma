-- Apply notification_scheduler_setup first, and store project_url and
-- notification_gateway_key (legacy anon JWT) in Vault.
-- All schedules use UTC; daily check/send run at 11:30/12:00 Japan time.
-- Retry only previously attempted deliveries between 12:05 and 20:55 Japan time.
select cron.schedule('honnoma-check-new-releases-at-1130-jst', '30 2 * * *', $job$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_gateway_key'),
    'x-honnoma-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_scheduler_secret')
  ),
  body := '{"mode":"check","limit":100}'::jsonb,
  timeout_milliseconds := 120000
);
$job$);

select cron.schedule('honnoma-deliver-new-release-notifications-at-1200-jst', '0 3 * * *', $job$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_gateway_key'),
    'x-honnoma-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_scheduler_secret')
  ),
  body := '{"mode":"deliver","userLimit":100}'::jsonb,
  timeout_milliseconds := 120000
);
$job$);

select cron.schedule('honnoma-retry-new-release-notifications', '5-55/10 3-11 * * *', $job$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_gateway_key'),
    'x-honnoma-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_scheduler_secret')
  ),
  body := '{"mode":"retry","userLimit":100}'::jsonb,
  timeout_milliseconds := 120000
);
$job$);

select cron.schedule('honnoma-check-push-receipts', '*/15 * * * *', $job$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/check-new-releases',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notification_gateway_key'),
    'x-honnoma-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notification_scheduler_secret')
  ),
  body := '{"mode":"receipts","userLimit":500}'::jsonb,
  timeout_milliseconds := 120000
);
$job$);
