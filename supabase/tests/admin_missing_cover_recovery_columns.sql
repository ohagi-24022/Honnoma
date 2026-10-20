begin;
do $$
begin
  if not has_column_privilege('service_role','public.books','thumbnail_url','UPDATE')
    or not has_column_privilege('service_role','public.books','isbn','UPDATE')
    or not has_column_privilege('service_role','public.books','publisher','UPDATE') then
    raise exception 'Cover recovery columns must be writable';
  end if;
  if has_column_privilege('service_role','public.books','user_id','UPDATE')
    or has_column_privilege('service_role','public.books','status','UPDATE')
    or has_table_privilege('service_role','public.books','DELETE') then
    raise exception 'Recovery must not gain ownership, reading record or deletion access';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.books'::regclass) then
    raise exception 'Library RLS must remain enabled';
  end if;
end $$;
rollback;
