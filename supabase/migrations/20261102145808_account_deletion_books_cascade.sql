-- Earlier CREATE TABLE IF NOT EXISTS did not update an existing NO ACTION FK.
-- This changes deletion behaviour only; no existing user or book is deleted.
do $migration$
begin
  perform set_config('lock_timeout', '5s', true);
  alter table public.books
    drop constraint books_user_id_fkey,
    add constraint books_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
end
$migration$;
