drop function if exists public.get_wanted_manga_rankings(integer);

create function public.get_wanted_manga_rankings(limit_count integer default 20)
returns table (
  title text,
  cover_url text,
  want_count bigint,
  average_score numeric,
  top_score integer,
  favorite_count bigint,
  owner_count bigint,
  owned_volume_count bigint,
  popularity_score numeric
)
language sql
security definer
set search_path = public
as $$
  with wanted as (
    select
      lower(regexp_replace(normalized_title, '[[:space:]\[\]()]', '', 'g')) as ranking_key,
      (array_agg(title order by score desc, updated_at desc))[1] as title,
      (array_agg(cover_url order by (cover_url is null), updated_at desc))[1] as wanted_cover_url,
      count(*) as want_count,
      round(avg(score)::numeric, 1) as average_score,
      max(score) as top_score
    from public.wanted_manga
    group by lower(regexp_replace(normalized_title, '[[:space:]\[\]()]', '', 'g'))
  ),
  owned as (
    select
      lower(
        regexp_replace(
          coalesce(nullif(series_title, ''), title),
          '[[:space:]\[\]()]',
          '',
          'g'
        )
      ) as ranking_key,
      (
        array_agg(
          coalesce(nullif(series_title, ''), title)
          order by
            case when volume_number = 1 then 0 else 1 end,
            volume_number nulls last,
            created_at asc
        )
      )[1] as title,
      (
        array_agg(
          thumbnail_url
          order by
            (thumbnail_url is null),
            case when volume_number = 1 then 0 else 1 end,
            volume_number nulls last,
            created_at asc
        )
      )[1] as cover_url,
      count(distinct user_id) as owner_count,
      count(*) as owned_volume_count
    from public.books
    group by lower(
      regexp_replace(
        coalesce(nullif(series_title, ''), title),
        '[[:space:]\[\]()]',
        '',
        'g'
      )
    )
  ),
  favorites as (
    select
      series_key as ranking_key,
      count(*) as favorite_count
    from public.favorite_series
    group by series_key
  ),
  ranked as (
    select
      coalesce(owned.title, wanted.title) as title,
      coalesce(owned.cover_url, wanted.wanted_cover_url) as cover_url,
      coalesce(wanted.want_count, 0) as want_count,
      case when coalesce(wanted.want_count, 0) >= 5 then wanted.average_score else null end as average_score,
      case when coalesce(wanted.want_count, 0) >= 5 then wanted.top_score else null end as top_score,
      coalesce(favorites.favorite_count, 0) as favorite_count,
      coalesce(owned.owner_count, 0) as owner_count,
      coalesce(owned.owned_volume_count, 0) as owned_volume_count,
      (
        coalesce(wanted.want_count, 0)::numeric * 2
        + coalesce(owned.owner_count, 0)::numeric * 3
        + coalesce(favorites.favorite_count, 0)::numeric * 2
        + case when coalesce(wanted.want_count, 0) >= 5 then coalesce(wanted.average_score, 0)::numeric * 0.03 else 0 end
      ) as popularity_score
    from wanted
    full outer join owned using (ranking_key)
    left join favorites using (ranking_key)
  )
  select *
  from ranked
  where title is not null
    and (want_count >= 3 or owner_count >= 3 or favorite_count >= 3)
  order by popularity_score desc, owner_count desc, favorite_count desc, want_count desc, title asc
  limit greatest(1, least(coalesce(limit_count, 20), 50));
$$;

revoke all on function public.get_wanted_manga_rankings(integer) from public;
grant execute on function public.get_wanted_manga_rankings(integer) to anon, authenticated;

drop function if exists public.get_favorite_series_rankings(integer);

create function public.get_favorite_series_rankings(limit_count integer default 20)
returns table (
  title text,
  cover_url text,
  want_count bigint,
  average_score numeric,
  top_score integer,
  favorite_count bigint,
  owner_count bigint,
  owned_volume_count bigint,
  popularity_score numeric
)
language sql
security definer
set search_path = public
as $$
  with favorites as (
    select
      series_key as ranking_key,
      (array_agg(series_title order by (cover_url is null), updated_at desc))[1] as title,
      (array_agg(cover_url order by (cover_url is null), updated_at desc))[1] as favorite_cover_url,
      count(*) as favorite_count,
      max(owned_volume_count) as favorite_owned_volume_count
    from public.favorite_series
    group by series_key
  ),
  owned as (
    select
      lower(
        regexp_replace(
          coalesce(nullif(series_title, ''), title),
          '[[:space:]\[\]()]',
          '',
          'g'
        )
      ) as ranking_key,
      (
        array_agg(
          coalesce(nullif(series_title, ''), title)
          order by
            case when volume_number = 1 then 0 else 1 end,
            volume_number nulls last,
            created_at asc
        )
      )[1] as title,
      (
        array_agg(
          thumbnail_url
          order by
            (thumbnail_url is null),
            case when volume_number = 1 then 0 else 1 end,
            volume_number nulls last,
            created_at asc
        )
      )[1] as cover_url,
      count(distinct user_id) as owner_count,
      count(*) as owned_volume_count
    from public.books
    group by lower(
      regexp_replace(
        coalesce(nullif(series_title, ''), title),
        '[[:space:]\[\]()]',
        '',
        'g'
      )
    )
  )
  select
    coalesce(owned.title, favorites.title) as title,
    coalesce(owned.cover_url, favorites.favorite_cover_url) as cover_url,
    0::bigint as want_count,
    0::numeric as average_score,
    0::integer as top_score,
    favorites.favorite_count,
    coalesce(owned.owner_count, 0) as owner_count,
    coalesce(owned.owned_volume_count, favorites.favorite_owned_volume_count, 0) as owned_volume_count,
    (
      favorites.favorite_count::numeric * 2
      + coalesce(owned.owner_count, 0)::numeric * 3
    ) as popularity_score
  from favorites
  left join owned using (ranking_key)
  where coalesce(owned.title, favorites.title) is not null
    and favorites.favorite_count >= 3
  order by favorites.favorite_count desc, owner_count desc, title asc
  limit greatest(1, least(coalesce(limit_count, 20), 100));
$$;

revoke all on function public.get_favorite_series_rankings(integer) from public;
grant execute on function public.get_favorite_series_rankings(integer) to anon, authenticated;
