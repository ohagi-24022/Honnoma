-- Public presentation comes exclusively from an operator-reviewed catalog.
-- User metadata caches are deliberately not a source: authenticated clients can edit them.
create table public.public_ranking_catalog (
  ranking_key text primary key check (length(btrim(ranking_key)) > 0),
  title text not null check (length(btrim(title)) > 0),
  cover_url text check (cover_url is null or cover_url like 'https://%'),
  source_url text not null check (source_url like 'https://%'),
  isbn text not null check (isbn ~ '^[0-9]{13}$'),
  reviewed_at timestamptz not null default now(),
  enabled boolean not null default false
);
alter table public.public_ranking_catalog enable row level security;
revoke all on public.public_ranking_catalog from public, anon, authenticated;
grant select on public.public_ranking_catalog to anon, authenticated;
grant select, insert, update, delete on public.public_ranking_catalog to service_role;
create policy "Read enabled ranking catalog" on public.public_ranking_catalog
  for select to anon, authenticated using (enabled);
comment on table public.public_ranking_catalog is
  'Operator-reviewed public titles/covers. Catalog inclusion is not an age-rating or rights certification. Never auto-approve client metadata.';

-- Preserve the three currently public works. ISBN/title checked against publisher records;
-- cover URLs match the existing displayed first-volume covers, not future client edits.
insert into public.public_ranking_catalog
  (ranking_key, title, cover_url, source_url, isbn, enabled)
values
 ('久保さんは僕モブを許さない', '久保さんは僕(モブ)を許さない',
  'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/4763/9784088914763.jpg?_ex=200x200',
  'https://www.s-manga.net/items/contents.html?isbn=9784088914763', '9784088914763', true),
 ('双星の陰陽師', '双星の陰陽師',
  'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0158/9784088800158.jpg?_ex=200x200',
  'https://www.shueisha.co.jp/books/items/contents.html?isbn=978-4-08-880015-8', '9784088800158', true),
 ('がっこうぐらし!', 'がっこうぐらし！',
  'https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/2364/9784832242364.jpg?_ex=200x200',
  'https://houbunsha.co.jp/patron/pdf/202307_ordersheet_mangatimeKR.pdf', '9784832242364', true);

create or replace function public.get_wanted_manga_rankings(limit_count integer default 20)
returns table (
  title text, cover_url text, want_count bigint, average_score numeric,
  top_score integer, favorite_count bigint, owner_count bigint,
  owned_volume_count bigint, popularity_score numeric
)
language sql security definer set search_path = ''
as $$
  with wanted as (
    select lower(regexp_replace(normalized_title, '[[:space:]\[\]()]', '', 'g')) as ranking_key,
      count(*) as want_count, round(avg(score)::numeric, 1) as average_score,
      max(score) as top_score
    from public.wanted_manga group by 1
  ),
  favorites as (
    select series_key as ranking_key, count(*) as favorite_count
    from public.favorite_series group by series_key
  ),
  owned as (
    select lower(regexp_replace(coalesce(nullif(series_title, ''), title), '[[:space:]\[\]()]', '', 'g')) as ranking_key,
      count(distinct user_id) as owner_count, count(*) as owned_volume_count
    from public.books group by 1
  ),
  ranked as (
    select catalog.title, catalog.cover_url,
      coalesce(wanted.want_count, 0) as want_count,
      case when wanted.want_count >= 5 then wanted.average_score else null end as average_score,
      case when wanted.want_count >= 5 then wanted.top_score else null end as top_score,
      coalesce(favorites.favorite_count, 0) as favorite_count,
      coalesce(owned.owner_count, 0) as owner_count,
      coalesce(owned.owned_volume_count, 0) as owned_volume_count,
      (coalesce(favorites.favorite_count, 0)::numeric * 2
       + coalesce(owned.owner_count, 0)::numeric * 3
       + coalesce(wanted.want_count, 0)::numeric * 2
       + case when wanted.want_count >= 5 then coalesce(wanted.average_score, 0)::numeric * 0.03 else 0 end
      ) as popularity_score
    from public.public_ranking_catalog catalog
    left join owned using (ranking_key)
    left join favorites using (ranking_key)
    left join wanted using (ranking_key)
    where catalog.enabled
  )
  select * from ranked
  where want_count >= 3 or owner_count >= 3 or favorite_count >= 3
  order by popularity_score desc, owner_count desc, favorite_count desc, want_count desc, title asc
  limit greatest(1, least(coalesce(limit_count, 20), 50));
$$;
revoke all on function public.get_wanted_manga_rankings(integer) from public;
grant execute on function public.get_wanted_manga_rankings(integer) to anon, authenticated;

create or replace function public.get_favorite_series_rankings(limit_count integer default 20)
returns table (
  title text, cover_url text, want_count bigint, average_score numeric,
  top_score integer, favorite_count bigint, owner_count bigint,
  owned_volume_count bigint, popularity_score numeric
)
language sql security definer set search_path = ''
as $$
  with favorites as (
    select series_key as ranking_key, count(*) as favorite_count
    from public.favorite_series group by series_key
  ),
  owned as (
    select lower(regexp_replace(coalesce(nullif(series_title, ''), title), '[[:space:]\[\]()]', '', 'g')) as ranking_key,
      count(distinct user_id) as owner_count, count(*) as owned_volume_count
    from public.books group by 1
  ),
  ranked as (
    select catalog.title, catalog.cover_url,
      0::bigint as want_count, 0::numeric as average_score, 0::integer as top_score,
      coalesce(favorites.favorite_count, 0) as favorite_count,
      coalesce(owned.owner_count, 0) as owner_count,
      coalesce(owned.owned_volume_count, 0) as owned_volume_count,
      (coalesce(favorites.favorite_count, 0)::numeric * 2
       + coalesce(owned.owner_count, 0)::numeric * 3
      ) as popularity_score
    from public.public_ranking_catalog catalog
    left join owned using (ranking_key)
    left join favorites using (ranking_key)
    where catalog.enabled
  )
  select * from ranked
  where favorite_count >= 3
  order by favorite_count desc, owner_count desc, title asc
  limit greatest(1, least(coalesce(limit_count, 20), 100));
$$;
revoke all on function public.get_favorite_series_rankings(integer) from public;
grant execute on function public.get_favorite_series_rankings(integer) to anon, authenticated;
