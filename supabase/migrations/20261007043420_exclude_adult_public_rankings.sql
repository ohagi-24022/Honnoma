-- Personal books and wishlist records are unaffected. Classify public presentation only.
-- NULL means unreviewed; false means not adults-only, NOT suitable for every age.
alter table public.public_ranking_catalog add column adult_only boolean;
comment on column public.public_ranking_catalog.adult_only is
  'Operator classification: true=adults-only, false=not adults-only, NULL=unreviewed. Only false may be publicly listed. Not an all-ages certification.';

-- The existing catalog contains these three ordinary publisher comic editions.
update public.public_ranking_catalog set adult_only=false
where isbn in ('9784088914763', '9784088800158', '9784832242364');

drop policy "Read enabled ranking catalog" on public.public_ranking_catalog;
create policy "Read enabled nonadult ranking catalog" on public.public_ranking_catalog
  for select to anon, authenticated using (enabled and adult_only is false);

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
    where catalog.enabled and catalog.adult_only is false
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
    where catalog.enabled and catalog.adult_only is false
  )
  select * from ranked
  where favorite_count >= 3
  order by favorite_count desc, owner_count desc, title asc
  limit greatest(1, least(coalesce(limit_count, 20), 100));
$$;
revoke all on function public.get_favorite_series_rankings(integer) from public;
grant execute on function public.get_favorite_series_rankings(integer) to anon, authenticated;
