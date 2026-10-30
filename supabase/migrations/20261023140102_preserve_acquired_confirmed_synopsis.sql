create or replace function public.record_book_synopsis_fetch(p_isbn text,p_status text,p_title text,p_description text,p_source_url text,p_provider text,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_isbn !~ '^(978|979)[0-9]{10}$' or p_status not in ('acquired','missing','failed') then raise exception 'Invalid acquisition'; end if;
 if p_status='acquired' and nullif(btrim(p_description),'') is null then raise exception 'Empty synopsis'; end if;
 insert into public.book_synopsis_fetches as old(isbn13,title,description,source_url,provider,status,reason,acquired_at)
 values(p_isbn,left(p_title,1000),case when p_status='acquired' then left(p_description,20000) end,p_source_url,p_provider,p_status,p_reason,case when p_status='acquired' then now() end)
 on conflict(isbn13) do update set
 description=coalesce(excluded.description,old.description),
 title=case when excluded.description is not null then excluded.title else old.title end,
 source_url=case when excluded.description is not null then excluded.source_url else old.source_url end,
 provider=case when excluded.description is not null then excluded.provider else old.provider end,
 status=excluded.status,reason=excluded.reason,attempts=old.attempts+1,attempted_at=now(),acquired_at=coalesce(excluded.acquired_at,old.acquired_at);
 if p_status='acquired' then
  -- Fill only missing text. Confirmed title, edition, cover and manual text remain authoritative.
  update public.confirmed_book_metadata set metadata=jsonb_set(metadata,'{description}',to_jsonb(left(p_description,20000)))
   where normalized_isbn=p_isbn and enabled and nullif(btrim(metadata->>'description'),'') is null;
  -- A failed retry never erases good text; no identity/cover/price/user edits are updated.
  insert into public.book_metadata_cache as old(isbn,normalized_isbn,title,description,source,source_url)
  values(p_isbn,p_isbn,left(p_title,1000),left(p_description,20000),case p_provider when 'openbd' then 'OpenBD' when 'google' then 'Google Books' when 'administrator' then 'Developer Override' else 'Rakuten Books' end,p_source_url)
  on conflict(normalized_isbn) where normalized_isbn is not null do update set
   description=excluded.description,source_url=excluded.source_url,fetched_at=now(),expires_at=now()+interval '30 days',updated_at=now();
 end if;
end;
$$;
revoke all on function public.record_book_synopsis_fetch(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_book_synopsis_fetch(text,text,text,text,text,text,text) to service_role;
