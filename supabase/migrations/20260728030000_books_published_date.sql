alter table public.books
  add column if not exists published_date text;

comment on column public.books.published_date is 'Publication date string from external book APIs, used for first-volume chronological sorting.';
