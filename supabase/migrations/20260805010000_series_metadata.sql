create table if not exists public.series_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  series_key text not null,
  series_title text not null,
  display_title text,
  latest_volume integer check (latest_volume is null or latest_volume > 0),
  is_completed boolean,
  cover_url text,
  publisher text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, series_key)
);

alter table public.series_metadata enable row level security;

drop policy if exists "series_metadata_select_own" on public.series_metadata;
create policy "series_metadata_select_own"
  on public.series_metadata
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "series_metadata_insert_own" on public.series_metadata;
create policy "series_metadata_insert_own"
  on public.series_metadata
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "series_metadata_update_own" on public.series_metadata;
create policy "series_metadata_update_own"
  on public.series_metadata
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "series_metadata_delete_own" on public.series_metadata;
create policy "series_metadata_delete_own"
  on public.series_metadata
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.series_metadata to authenticated;
grant all on public.series_metadata to service_role;

create index if not exists series_metadata_user_id_idx on public.series_metadata(user_id);
create index if not exists series_metadata_series_key_idx on public.series_metadata(series_key);
