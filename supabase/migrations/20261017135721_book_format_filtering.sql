-- Book format is separate from main/companion volume classification.
-- Existing clients may omit it; no ownership or visibility policies are changed.
alter table public.books add column book_format text
  check (book_format is null or book_format in ('comic','novel','unknown'));
comment on column public.books.book_format is
'Personal bibliographic format: comic, novel, unknown. Independent of volume_kind and content approval.';
