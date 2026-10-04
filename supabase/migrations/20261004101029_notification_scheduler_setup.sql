create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Compare inside Vault without returning the secret. Only the Edge Function's
-- service role may execute this RPC; client roles cannot use it.
create or replace function public.is_notification_scheduler_authorized(provided_token text)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select length(coalesce(provided_token, '')) >= 32 and exists (
    select 1 from vault.decrypted_secrets
    where name = 'notification_scheduler_secret' and decrypted_secret = provided_token
  );
$$;
revoke all on function public.is_notification_scheduler_authorized(text) from public, anon, authenticated;
grant execute on function public.is_notification_scheduler_authorized(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notification_scheduler_secret') then
    perform vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'notification_scheduler_secret');
  end if;
end;
$$;
