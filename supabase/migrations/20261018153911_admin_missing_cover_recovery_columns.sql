-- Server-side cover recovery may supplement only these bibliographic fields.
-- Keep ownership, reading records, table-wide UPDATE and DELETE inaccessible.
grant update (isbn, thumbnail_url, publisher) on table public.books to service_role;
