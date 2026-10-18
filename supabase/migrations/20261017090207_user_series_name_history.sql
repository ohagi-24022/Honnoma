-- Private per-book names, protected by the existing books ownership policies.
-- No catalog/ranking aliases or other users' books are changed.
alter table public.books add column series_aliases text[] not null default '{}';

create function public.remember_book_series_names()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select coalesce(array_agg(distinct name order by name), '{}'::text[])
  into new.series_aliases
  from unnest(coalesce(old.series_aliases, '{}') || coalesce(new.series_aliases, '{}') || array[old.series_title]) as names(name)
  where name is not null and btrim(name) <> '';
  return new;
end;
$$;

revoke all on function public.remember_book_series_names() from public, anon, authenticated;

create trigger remember_book_series_names
before update of series_title on public.books
for each row
when (old.series_title is distinct from new.series_title)
execute function public.remember_book_series_names();

comment on column public.books.series_aliases is
'Previous private series names, retained when renaming so later volumes can join the user-selected series.';
