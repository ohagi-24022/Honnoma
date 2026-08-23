create table if not exists public.series_reading_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_key text not null,
  series_title text not null,
  current_reading text,
  suggested_reading text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_reading_suggestions_series_key_not_blank check (length(btrim(series_key)) > 0),
  constraint series_reading_suggestions_series_title_not_blank check (length(btrim(series_title)) > 0),
  constraint series_reading_suggestions_suggested_reading_not_blank check (length(btrim(suggested_reading)) > 0)
);

create unique index if not exists series_reading_suggestions_user_series_key_idx
  on public.series_reading_suggestions(user_id, series_key);

create index if not exists series_reading_suggestions_series_key_idx
  on public.series_reading_suggestions(series_key);

alter table public.series_reading_suggestions enable row level security;

create policy "series reading suggestions are selectable by owner"
  on public.series_reading_suggestions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "series reading suggestions are insertable by owner"
  on public.series_reading_suggestions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "series reading suggestions are updatable by owner"
  on public.series_reading_suggestions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "series reading suggestions are deletable by owner"
  on public.series_reading_suggestions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.series_reading_suggestions to authenticated;
grant select on public.series_reading_suggestions to service_role;

comment on table public.series_reading_suggestions is 'User-submitted series title reading suggestions for later aggregation and metadata correction.';
comment on column public.series_reading_suggestions.series_key is 'Normalized key generated from the series title in the app.';
comment on column public.series_reading_suggestions.suggested_reading is 'User-submitted kana reading or reading hint for the series title.';
