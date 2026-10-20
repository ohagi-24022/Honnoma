-- Personal library lookups may use the exact administrator-confirmed source
-- cover. Anonymous/non-owning callers and public rankings remain reviewed-only.
create or replace function public.get_confirmed_book_metadata(p_isbn text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('metadata',(
  select c.metadata - 'thumbnail_url' - 'description' || jsonb_build_object(
   'thumbnail_url',coalesce(r.cover_url,case when auth.uid() is not null and (
     exists(select 1 from public.books b where b.user_id=auth.uid() and b.isbn=c.normalized_isbn)
     or exists(select 1 from public.wanted_manga w where w.user_id=auth.uid() and w.isbn=c.normalized_isbn)
    ) and c.metadata->>'thumbnail_url' ~ '^https://' then c.metadata->>'thumbnail_url' end),
   'description',r.description,'confirmed_at',c.confirmed_at)
  from public.confirmed_book_metadata c
  left join public.reviewed_book_content r on r.isbn13=c.normalized_isbn and r.enabled
  where c.normalized_isbn=upper(regexp_replace(p_isbn,'[^0-9Xx]','','g')) and c.enabled
 ));
$$;
revoke all on function public.get_confirmed_book_metadata(text) from public;
grant execute on function public.get_confirmed_book_metadata(text) to anon,authenticated,service_role;
