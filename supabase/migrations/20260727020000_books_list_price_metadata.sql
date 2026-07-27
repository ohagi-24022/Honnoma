alter table public.books
  add column if not exists list_price integer,
  add column if not exists price_source text,
  add column if not exists price_fetched_at timestamptz;

comment on column public.books.list_price is 'API-provided list or retail price in JPY.';
comment on column public.books.price_source is 'Provider used to fetch list_price, such as rakuten or google.';
comment on column public.books.price_fetched_at is 'Timestamp when list_price was fetched.';
