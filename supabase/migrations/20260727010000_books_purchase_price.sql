alter table public.books
  add column if not exists purchase_price integer;

comment on column public.books.purchase_price is 'Optional user-entered purchase price in JPY.';
