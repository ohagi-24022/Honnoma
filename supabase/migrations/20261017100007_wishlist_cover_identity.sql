alter table public.wanted_manga add column isbn text
  check (isbn is null or isbn ~ '^(978|979)[0-9]{10}$');

create function public.align_wanted_cover_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_isbn text; v_sum integer; v_cover text;
begin
  v_isbn:=nullif(regexp_replace(coalesce(new.isbn,''),'[^0-9Xx]','','g'),'');
  if v_isbn is null then
    -- Only fixed, known ISBN URL formats; never infer from arbitrary host paths.
    v_isbn:=coalesce(
      substring(new.cover_url from '^https://thumbnail[.]image[.]rakuten[.]co[.]jp/@0_mall/book/cabinet/(?:[0-9]+/)*((?:978|979)[0-9]{10})(?:[_.?]|$)'),
      substring(new.cover_url from '^https://cover[.]openbd[.]jp/((?:978|979)[0-9]{10})[.](?:jpg|png)(?:[?]|$)'),
      substring(new.cover_url from '^https://dosbg3xlm0x1t[.]cloudfront[.]net/images/items/((?:978|979)[0-9]{10})/[0-9]+/\1[.](?:jpg|png|webp)(?:[?]|$)')
    );
    if v_isbn is null then
      select case when count(distinct r.isbn13)=1 then min(r.isbn13) else null end into v_isbn
      from public.reviewed_book_content r where r.enabled and r.cover_url=new.cover_url;
    end if;
  end if;
  if v_isbn ~ '^(978|979)[0-9]{10}$' then
    select sum(substr(v_isbn,n,1)::integer * case when n%2=0 then 3 else 1 end)
      into v_sum from generate_series(1,13) n;
    if v_sum%10<>0 then v_isbn:=null; end if;
  else v_isbn:=null;
  end if;
  new.isbn:=v_isbn;
  if v_isbn is not null then
    -- Approved media only. Unreviewed originals are retained as identity hints,
    -- but this trigger never publishes or approves those images.
    select r.cover_url into v_cover from public.reviewed_book_content r
    where r.isbn13=v_isbn and r.enabled and r.cover_url is not null;
    if v_cover is not null then new.cover_url:=v_cover; end if;
  end if;
  return new;
end $$;
revoke all on function public.align_wanted_cover_identity() from public,anon,authenticated;

create trigger align_wanted_cover_identity
before insert or update of isbn,cover_url on public.wanted_manga
for each row execute function public.align_wanted_cover_identity();

create trigger queue_book_content_on_wanted
after insert or update of isbn on public.wanted_manga
for each row execute function public.queue_registered_book_content();

comment on column public.wanted_manga.isbn is
'ISBN of the explicitly selected cover publication; independent of URL changes and user title edits.';
