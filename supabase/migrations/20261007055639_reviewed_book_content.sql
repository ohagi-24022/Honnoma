-- Reviewed display payloads are independent of private books and public series rankings.
create table public.reviewed_book_content (
  isbn13 text primary key check (isbn13 ~ '^[0-9]{13}$'),
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  description text check (description is null or length(description) <= 20000),
  source_url text not null check (source_url ~ '^https://'),
  reviewed_at timestamptz not null default now(),
  enabled boolean not null default false
);
alter table public.reviewed_book_content enable row level security;
revoke all on public.reviewed_book_content from public, anon, authenticated;
grant select on public.reviewed_book_content to anon, authenticated;
grant select, insert, update, delete on public.reviewed_book_content to service_role;
create policy "Read enabled reviewed content" on public.reviewed_book_content
  for select to anon, authenticated using (enabled);
create index reviewed_book_content_cover_idx on public.reviewed_book_content (cover_url) where enabled;
-- No automatic import from client-editable metadata or from series approval.
