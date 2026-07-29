alter table public.books
  add column if not exists title_reading text,
  add column if not exists series_reading text;

comment on column public.books.title_reading is 'Kana reading of the book title, used for Japanese gojuon sorting when available.';
comment on column public.books.series_reading is 'Kana reading of the series title, used for Japanese gojuon sorting when available.';
