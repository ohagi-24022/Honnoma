create table if not exists public.book_metadata_overrides (
  id uuid primary key default gen_random_uuid(),
  isbn text,
  normalized_isbn text,
  title text,
  subtitle text,
  series_title text,
  series_key text,
  volume_number integer,
  author text,
  publisher text,
  description text,
  thumbnail_url text,
  source_url text,
  source text not null default 'developer',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normalized_isbn is not null or (series_key is not null and volume_number is not null) or title is not null),
  check (source_url is null or source_url ~ '^https://')
);

create unique index if not exists book_metadata_overrides_normalized_isbn_key
  on public.book_metadata_overrides (normalized_isbn)
  where normalized_isbn is not null;

create index if not exists book_metadata_overrides_series_volume_idx
  on public.book_metadata_overrides (series_key, volume_number)
  where series_key is not null and volume_number is not null;

create index if not exists book_metadata_overrides_enabled_idx
  on public.book_metadata_overrides (enabled);

alter table public.book_metadata_overrides enable row level security;

revoke all on public.book_metadata_overrides from anon, authenticated;
grant all on public.book_metadata_overrides to service_role;

insert into public.book_metadata_overrides (
  isbn,
  normalized_isbn,
  title,
  series_title,
  series_key,
  author,
  publisher,
  thumbnail_url,
  source_url,
  source,
  enabled
) values (
  '9784088927343',
  '9784088927343',
  'GIFT 久保さんは僕(モブ)を許さない 完結記念公式ファンブック',
  '久保さんは僕(モブ)を許さない',
  '久保さんは僕を許さない',
  '雪森寧々',
  '集英社',
  'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088927343/1200/9784088927343.jpg',
  'https://www.s-manga.net/items/contents.html?isbn=9784088927343',
  'developer',
  true
)
on conflict (normalized_isbn) where (normalized_isbn is not null) do update set
  title = excluded.title,
  series_title = excluded.series_title,
  series_key = excluded.series_key,
  author = excluded.author,
  publisher = excluded.publisher,
  thumbnail_url = excluded.thumbnail_url,
  source_url = excluded.source_url,
  source = excluded.source,
  enabled = excluded.enabled,
  updated_at = now();

comment on table public.book_metadata_overrides is 'Developer-maintained metadata corrections. App clients cannot read this table directly; corrections are maintained by the external developer admin app, which can expose one matching enabled correction through its public lookup API.';
comment on column public.book_metadata_overrides.source_url is 'Canonical public page used as the correction source, such as a publisher item detail URL.';


