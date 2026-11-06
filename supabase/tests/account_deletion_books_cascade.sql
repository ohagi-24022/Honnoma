-- Synthetic data only. ROLLBACK preserves all existing users and books.
begin;

do $test$
declare
  deleting_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  existing_users bigint := (select count(*) from auth.users);
  existing_books bigint := (select count(*) from public.books);
begin
  insert into auth.users (id) values (deleting_user), (other_user);
  insert into public.books (user_id, title, series_title)
    values (deleting_user, 'Account deletion fixture A', 'Account deletion fixture'),
           (other_user, 'Account deletion fixture B', 'Account deletion fixture');

  -- Same database delete invoked by Auth Admin. Never target an existing user.
  delete from auth.users where id = deleting_user;
  if exists (select 1 from public.books where user_id = deleting_user) then
    raise exception 'Deleted user retained books';
  end if;
  if not exists (select 1 from auth.users where id = other_user)
     or (select count(*) from public.books where user_id = other_user) <> 1 then
    raise exception 'Unrelated user or books changed';
  end if;
  if (select count(*) from auth.users) <> existing_users + 1
     or (select count(*) from public.books) <> existing_books + 1 then
    raise exception 'Existing account data changed';
  end if;

  -- Empty accounts must still be removable too.
  delete from auth.users where id = other_user;
  if (select count(*) from auth.users) <> existing_users
     or (select count(*) from public.books) <> existing_books then
    raise exception 'Fixture cleanup was incomplete';
  end if;
end
$test$;

rollback;
