-- Administrator corrections are synced into confirmed_book_metadata by the existing trigger.
alter table public.book_metadata_overrides
  add column if not exists book_format text check (book_format in ('comic','novel','unknown')),
  add column if not exists volume_kind text check (volume_kind in ('main','extra'));
