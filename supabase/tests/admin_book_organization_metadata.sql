begin;
update public.book_metadata_overrides set book_format='comic',volume_kind='main'
where normalized_isbn='9784757549920';
do $$
begin
  if not exists(select 1 from public.confirmed_book_metadata where normalized_isbn='9784757549920'
    and metadata->>'book_format'='comic' and metadata->>'volume_kind'='main') then
    raise exception 'Organization fields must sync to confirmed ISBN metadata';
  end if;
  if public.get_confirmed_book_metadata('9784757549920')->'metadata'->>'book_format' is distinct from 'comic' then
    raise exception 'Clients must receive the confirmed book format';
  end if;
  begin
    update public.book_metadata_overrides set book_format='invalid' where normalized_isbn='9784757549920';
    raise exception 'Invalid book format accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
