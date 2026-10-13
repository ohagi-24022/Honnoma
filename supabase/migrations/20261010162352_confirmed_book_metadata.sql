-- Keep provider originals privately; a confirmed ISBN is independent of provider refreshes.
create table public.confirmed_book_metadata (
  normalized_isbn text primary key,
  metadata jsonb not null,
  provider_original jsonb,
  enabled boolean not null default true,
  confirmed_at timestamptz not null default now()
);
alter table public.confirmed_book_metadata enable row level security;
revoke all on public.confirmed_book_metadata from public, anon, authenticated;
grant all on public.confirmed_book_metadata to service_role;

alter table public.book_metadata_cache drop constraint book_metadata_cache_source_check;
alter table public.book_metadata_cache add constraint book_metadata_cache_source_check
  check (source in ('Google Books','OpenBD','Rakuten Books','Developer Override'));

create function public.protect_confirmed_book_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_metadata jsonb;
begin
  if tg_op <> 'INSERT' then
    select metadata into v_metadata from public.confirmed_book_metadata
      where normalized_isbn = old.normalized_isbn and enabled;
    if v_metadata is not null and (tg_op = 'DELETE' or new.normalized_isbn is distinct from old.normalized_isbn) then
      raise exception 'Confirmed ISBN cannot be deleted or reassigned by a metadata refresh';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select metadata into v_metadata from public.confirmed_book_metadata
    where normalized_isbn = new.normalized_isbn and enabled;
  if v_metadata is not null then
    new := jsonb_populate_record(new, v_metadata || jsonb_build_object(
      'source','Developer Override','expires_at','9999-12-31T00:00:00Z'));
  elsif new.source = 'Developer Override' then
    raise exception 'Confirmed metadata must be saved through the administrator';
  end if;
  return new;
end $$;
revoke all on function public.protect_confirmed_book_metadata() from public, anon, authenticated, service_role;
create trigger protect_confirmed_metadata before insert or update or delete on public.book_metadata_cache
  for each row execute function public.protect_confirmed_book_metadata();

create function public.sync_confirmed_book_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_isbn text; v_original jsonb; v_metadata jsonb; v_cached public.book_metadata_cache; v_row public.book_metadata_cache;
begin
  -- Disabling, deleting or changing an ISBN restores its provider original atomically.
  if tg_op <> 'INSERT' then
    v_isbn := old.normalized_isbn;
    if tg_op = 'DELETE' or new.normalized_isbn is distinct from v_isbn or not new.enabled then
      select provider_original into v_original from public.confirmed_book_metadata where normalized_isbn=v_isbn;
      update public.confirmed_book_metadata set enabled=false, confirmed_at=now() where normalized_isbn=v_isbn;
      if found then
        if v_original is null then
          delete from public.book_metadata_cache where normalized_isbn=v_isbn;
        else
          v_row := jsonb_populate_record(null::public.book_metadata_cache, v_original);
          update public.book_metadata_cache set
            isbn=v_row.isbn,title=v_row.title,subtitle=v_row.subtitle,series_title=v_row.series_title,series_key=v_row.series_key,
            volume_number=v_row.volume_number,author=v_row.author,publisher=v_row.publisher,description=v_row.description,
            thumbnail_url=v_row.thumbnail_url,list_price=v_row.list_price,price_source=v_row.price_source,
            price_fetched_at=v_row.price_fetched_at,source=v_row.source,source_url=v_row.source_url,
            fetched_at=v_row.fetched_at,expires_at=v_row.expires_at,updated_at=now()
          where normalized_isbn=v_isbn;
        end if;
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not new.enabled or new.normalized_isbn is null then return new; end if;
  v_isbn := new.normalized_isbn;
  select * into v_cached from public.book_metadata_cache where normalized_isbn=v_isbn;
  select provider_original into v_original from public.confirmed_book_metadata where normalized_isbn=v_isbn;
  if not found then v_original := case when v_cached.id is null then null else to_jsonb(v_cached) end; end if;
  -- Freeze the completed metadata once, instead of filling blanks from changing providers on every request.
  v_metadata := coalesce(to_jsonb(v_cached),'{}'::jsonb) || jsonb_strip_nulls(to_jsonb(new));
  v_metadata := v_metadata - 'id' - 'enabled' - 'created_at' - 'updated_at';
  if nullif(v_metadata->>'title','') is null then return new; end if;
  v_metadata := v_metadata || jsonb_build_object('isbn',v_isbn,'normalized_isbn',v_isbn,'source','Developer Override',
    'fetched_at',now(),'expires_at','9999-12-31T00:00:00Z');
  insert into public.confirmed_book_metadata(normalized_isbn,metadata,provider_original,enabled,confirmed_at)
    values(v_isbn,v_metadata,v_original,true,now())
    on conflict(normalized_isbn) do update set metadata=excluded.metadata,enabled=true,confirmed_at=excluded.confirmed_at;
  v_row := jsonb_populate_record(null::public.book_metadata_cache,v_metadata);
  insert into public.book_metadata_cache(isbn,normalized_isbn,title,subtitle,series_title,series_key,volume_number,author,publisher,
    description,thumbnail_url,list_price,price_source,price_fetched_at,source,source_url,fetched_at,expires_at)
    values(v_row.isbn,v_isbn,v_row.title,v_row.subtitle,v_row.series_title,v_row.series_key,v_row.volume_number,v_row.author,v_row.publisher,
      v_row.description,v_row.thumbnail_url,v_row.list_price,v_row.price_source,v_row.price_fetched_at,v_row.source,v_row.source_url,v_row.fetched_at,v_row.expires_at)
    on conflict(normalized_isbn) where normalized_isbn is not null do update set
      title=excluded.title,subtitle=excluded.subtitle,series_title=excluded.series_title,series_key=excluded.series_key,
      volume_number=excluded.volume_number,author=excluded.author,publisher=excluded.publisher,description=excluded.description,
      thumbnail_url=excluded.thumbnail_url,list_price=excluded.list_price,price_source=excluded.price_source,
      price_fetched_at=excluded.price_fetched_at,source=excluded.source,source_url=excluded.source_url,
      fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,updated_at=now();
  return new;
end $$;
revoke all on function public.sync_confirmed_book_metadata() from public, anon, authenticated, service_role;
create trigger sync_confirmed_metadata after insert or update or delete on public.book_metadata_overrides
  for each row execute function public.sync_confirmed_book_metadata();

-- Public lookup exposes one exact ISBN and only already-reviewed media. Private provider originals stay private.
create function public.get_confirmed_book_metadata(p_isbn text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('metadata',(
    select c.metadata - 'thumbnail_url' - 'description' || jsonb_build_object(
      'thumbnail_url',r.cover_url,'description',r.description,'confirmed_at',c.confirmed_at)
    from public.confirmed_book_metadata c
    left join public.reviewed_book_content r on r.isbn13=c.normalized_isbn and r.enabled
    where c.normalized_isbn=upper(regexp_replace(p_isbn,'[^0-9Xx]','','g')) and c.enabled
  ));
$$;
revoke all on function public.get_confirmed_book_metadata(text) from public;
grant execute on function public.get_confirmed_book_metadata(text) to anon, authenticated, service_role;

-- Correct an existing normal/limited edition mix without changing anyone's registered ISBN.
update public.book_metadata_overrides set title='ハイキュー!! 15 DVDアニメ同梱版',subtitle='DVDアニメ同梱版',
  source_url='https://books.rakuten.co.jp/rb/13028141/',
  thumbnail_url='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/2386/9784089082386.gif',
  description='DVDアニメを同梱したハイキュー!! 第15巻の限定版。',updated_at=now()
where normalized_isbn='9784089082386';
update public.book_metadata_overrides set updated_at=updated_at where enabled and normalized_isbn is not null;
comment on table public.confirmed_book_metadata is 'Administrator-confirmed exact-ISBN metadata, protected from provider refreshes, with private original provider snapshot.';
