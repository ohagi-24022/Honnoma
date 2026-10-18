-- UPDATE OF tests the SET list, not fields assigned by a BEFORE trigger.
-- Old app versions send cover_url without isbn, so include that column too.
drop trigger queue_book_content_on_wanted on public.wanted_manga;
create trigger queue_book_content_on_wanted
after insert or update of isbn,cover_url on public.wanted_manga
for each row execute function public.queue_registered_book_content();
