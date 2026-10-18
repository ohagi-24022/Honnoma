-- Keep the existing worker URL, authentication, and enabled-subscription guard.
-- Run at 11:30, 11:40 and 11:50 JST. Successful lookups use the 20-hour cache.
begin;
select cron.alter_job(job_id := jobid, schedule := '30,40,50 2 * * *')
from cron.job where jobname = 'honnoma-check-new-releases-at-1130-jst';
select jobname,schedule,active from cron.job
where jobname = 'honnoma-check-new-releases-at-1130-jst';
commit;
