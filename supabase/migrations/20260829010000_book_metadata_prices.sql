alter table public.book_metadata_cache
  add column if not exists list_price integer,
  add column if not exists price_source text,
  add column if not exists price_fetched_at timestamptz;

alter table public.book_metadata_overrides
  add column if not exists list_price integer,
  add column if not exists price_source text,
  add column if not exists price_fetched_at timestamptz;

alter table public.book_metadata_cache
  drop constraint if exists book_metadata_cache_price_source_check;

alter table public.book_metadata_cache
  add constraint book_metadata_cache_price_source_check
  check (price_source is null or price_source in ('rakuten', 'google', 'manual'));

alter table public.book_metadata_overrides
  drop constraint if exists book_metadata_overrides_price_source_check;

alter table public.book_metadata_overrides
  add constraint book_metadata_overrides_price_source_check
  check (price_source is null or price_source in ('rakuten', 'google', 'manual'));

comment on column public.book_metadata_cache.list_price is 'Reference new-book price fetched from metadata APIs, usually Rakuten Books itemPrice.';
comment on column public.book_metadata_overrides.list_price is 'Developer-maintained reference new-book price override.';