-- Acquisition state is separate from content classification and public approval.
create table public.book_synopsis_fetches (
 isbn13 text primary key check (isbn13 ~ '^(978|979)[0-9]{10}$'),
 title text not null default '',
 description text,
 source_url text,
 provider text,
 status text not null check (status in ('acquired','missing','failed')),
 reason text check (reason in ('no_synopsis','provider_unavailable')),
 attempts integer not null default 1,
 attempted_at timestamptz not null default now(),
 acquired_at timestamptz,
 check (description is null or length(description) <= 20000)
);
alter table public.book_synopsis_fetches enable row level security;
revoke all on public.book_synopsis_fetches from public,anon,authenticated;
grant all on public.book_synopsis_fetches to service_role;

create function public.record_book_synopsis_fetch(p_isbn text,p_status text,p_title text,p_description text,p_source_url text,p_provider text,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_isbn !~ '^(978|979)[0-9]{10}$' or p_status not in ('acquired','missing','failed') then raise exception 'Invalid acquisition'; end if;
 if p_status='acquired' and nullif(btrim(p_description),'') is null then raise exception 'Empty synopsis'; end if;
 insert into public.book_synopsis_fetches as old(isbn13,title,description,source_url,provider,status,reason,acquired_at)
 values(p_isbn,left(p_title,1000),case when p_status='acquired' then left(p_description,20000) end,p_source_url,p_provider,p_status,p_reason,case when p_status='acquired' then now() end)
 on conflict(isbn13) do update set
 description=coalesce(excluded.description,old.description),
 title=case when excluded.description is not null then excluded.title else old.title end,
 source_url=case when excluded.description is not null then excluded.source_url else old.source_url end,
 provider=case when excluded.description is not null then excluded.provider else old.provider end,
 status=excluded.status,reason=excluded.reason,attempts=old.attempts+1,attempted_at=now(),acquired_at=coalesce(excluded.acquired_at,old.acquired_at);
 if p_status='acquired' then
  -- A failed retry never erases good text; no identity/cover/price/user edits are updated.
  insert into public.book_metadata_cache as old(isbn,normalized_isbn,title,description,source,source_url)
  values(p_isbn,p_isbn,left(p_title,1000),left(p_description,20000),case p_provider when 'openbd' then 'OpenBD' when 'google' then 'Google Books' when 'administrator' then 'Developer Override' else 'Rakuten Books' end,p_source_url)
  on conflict(normalized_isbn) where normalized_isbn is not null do update set
   description=excluded.description,source_url=excluded.source_url,fetched_at=now(),expires_at=now()+interval '30 days',updated_at=now();
 end if;
end;
$$;
revoke all on function public.record_book_synopsis_fetch(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_book_synopsis_fetch(text,text,text,text,text,text,text) to service_role;

create function public.admin_book_synopsis_inventory(p_query text default '',p_state text default 'all',p_size integer default 30,p_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
 with identities as (
  select b.isbn as isbn,b.title,1 as priority from public.books b where b.isbn ~ '^(978|979)[0-9]{10}$'
  union all select w.isbn,w.title,2 from public.wanted_manga w where w.isbn ~ '^(978|979)[0-9]{10}$'
  union all select j.isbn13,j.title,3 from public.book_content_review_jobs j where j.review_requested
 ), ids as (select distinct on (isbn) isbn,title from identities order by isbn,priority,title),
 inventory as (
  select i.isbn,i.title,
   coalesce(nullif(btrim(s.description),''),nullif(btrim(r.description),''),nullif(btrim(c.metadata->>'description'),''),nullif(btrim(k.description),''),nullif(btrim(j.candidate->>'description'),'')) as description,
   s.status,s.reason,s.attempted_at,s.attempts,
   case when nullif(btrim(s.description),'') is not null then s.source_url when nullif(btrim(r.description),'') is not null then r.source_url when nullif(btrim(c.metadata->>'description'),'') is not null then c.metadata->>'source_url' when nullif(btrim(k.description),'') is not null then k.source_url else j.candidate->>'source_url' end as source_url,
   s.provider
  from ids i
  left join public.book_synopsis_fetches s on s.isbn13=i.isbn
  left join public.reviewed_book_content r on r.isbn13=i.isbn and r.enabled
  left join public.confirmed_book_metadata c on c.normalized_isbn=i.isbn and c.enabled
  left join public.book_metadata_cache k on k.normalized_isbn=i.isbn
  left join public.book_content_review_jobs j on j.isbn13=i.isbn
 ), filtered as (
  select *,case when description is not null then 'acquired' else coalesce(status,'unfetched') end as display_status from inventory
  where (coalesce(p_query,'')='' or position(translate(lower(p_query),'！？','!?') in translate(lower(title),'！？','!?'))>0 or position(p_query in isbn)>0)
 ), matched as (select * from filtered where p_state='all' or display_status=p_state),
 counts as (select count(*)::integer as total,greatest(1,least(100,coalesce(p_size,30))) as size from matched),
 paging as (select *,greatest(1,least(coalesce(p_page,1),greatest(1,ceil(total::numeric/size)::integer))) as page from counts),
 rows as (select m.* from matched m order by m.title,m.isbn limit (select size from paging) offset (select (page-1)*size from paging))
 select jsonb_build_object('count',total,'page',page,'rows',coalesce((select jsonb_agg(to_jsonb(rows)) from rows),'[]'::jsonb)) from paging;
$$;
revoke all on function public.admin_book_synopsis_inventory(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_book_synopsis_inventory(text,text,integer,integer) to service_role;
