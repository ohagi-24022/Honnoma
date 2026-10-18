create table public.public_ranking_aliases (
 alias_key text primary key,
 ranking_key text not null references public.public_ranking_catalog(ranking_key),
 check(alias_key<>ranking_key)
);
alter table public.public_ranking_aliases enable row level security;
revoke all on public.public_ranking_aliases from public,anon,authenticated;
grant all on public.public_ranking_aliases to service_role;
create function public.resolve_public_ranking_key(p_key text) returns text
language sql stable set search_path='' as $$
 select coalesce((select ranking_key from public.public_ranking_aliases where alias_key=p_key),p_key);
$$;
revoke all on function public.resolve_public_ranking_key(text) from public,anon,authenticated;
grant execute on function public.resolve_public_ranking_key(text) to service_role;
insert into public.public_ranking_aliases(alias_key,ranking_key) values('がっこうぐらし','がっこうぐらし!');
update public.public_ranking_catalog set enabled=false,reviewed_at=now() where ranking_key='がっこうぐらし';
update public.public_ranking_catalog c set cover_url=r.cover_url,source_url=r.source_url,reviewed_at=now()
 from public.reviewed_book_content r where c.ranking_key='がっこうぐらし!' and r.isbn13=c.isbn and r.enabled and r.cover_url is not null;
update public.public_ranking_catalog c set isbn=r.isbn13,cover_url=r.cover_url,source_url=r.source_url,reviewed_at=now()
 from public.reviewed_book_content r where c.ranking_key='名探偵コナン' and r.isbn13='9784091233714' and r.enabled and r.cover_url is not null;
update public.book_content_review_jobs set candidate=candidate||jsonb_build_object('series_title','名探偵コナン','volume_number',1),
 content_hash=encode(sha256(convert_to((candidate||jsonb_build_object('series_title','名探偵コナン','volume_number',1))::text,'UTF8')),'hex'),updated_at=now()
 where isbn13='9784091233714';
CREATE OR REPLACE FUNCTION public.get_wanted_manga_rankings(limit_count integer DEFAULT 20)
 RETURNS TABLE(title text, cover_url text, want_count bigint, average_score numeric, top_score integer, favorite_count bigint, owner_count bigint, owned_volume_count bigint, popularity_score numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with wanted as (
    select public.resolve_public_ranking_key(lower(regexp_replace(normalized_title, '[[:space:]\[\]()]', '', 'g'))) as ranking_key,
      count(*) as want_count, round(avg(score)::numeric, 1) as average_score,
      max(score) as top_score
    from public.wanted_manga group by 1
  ),
  favorites as (
    select public.resolve_public_ranking_key(series_key) as ranking_key, count(distinct user_id) as favorite_count
    from public.favorite_series group by 1
  ),
  owned as (
    select public.resolve_public_ranking_key(lower(regexp_replace(coalesce(nullif(series_title, ''), title), '[[:space:]\[\]()]', '', 'g'))) as ranking_key,
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_favorite_series_rankings(limit_count integer DEFAULT 20)
 RETURNS TABLE(title text, cover_url text, want_count bigint, average_score numeric, top_score integer, favorite_count bigint, owner_count bigint, owned_volume_count bigint, popularity_score numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with favorites as (
    select public.resolve_public_ranking_key(series_key) as ranking_key, count(distinct user_id) as favorite_count
    from public.favorite_series group by 1
  ),
  owned as (
    select public.resolve_public_ranking_key(lower(regexp_replace(coalesce(nullif(series_title, ''), title), '[[:space:]\[\]()]', '', 'g'))) as ranking_key,
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
$function$
;
