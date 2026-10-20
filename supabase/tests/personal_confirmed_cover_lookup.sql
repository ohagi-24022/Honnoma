-- Runtime account placeholder; test writes no permanent data.
begin;
set local role anon;
do $$ begin
 if public.get_confirmed_book_metadata('9784065130872')->'metadata'->>'thumbnail_url' is not null then raise exception 'Anonymous caller received unreviewed image'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','__TARGET_USER_ID__',true);
set local role authenticated;
do $$ begin
 if public.get_confirmed_book_metadata('9784065130872')->'metadata'->>'thumbnail_url' is null then raise exception 'Owner did not receive confirmed source'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
set local role authenticated;
do $$ begin
 if public.get_confirmed_book_metadata('9784065130872')->'metadata'->>'thumbnail_url' is not null then raise exception 'Other account received unreviewed source'; end if;
end $$;
rollback;
