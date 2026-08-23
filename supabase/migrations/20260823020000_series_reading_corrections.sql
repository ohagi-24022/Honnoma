create table if not exists public.series_reading_corrections (
  series_key text primary key,
  series_title text not null,
  corrected_reading text not null,
  suggestion_count integer not null default 0,
  total_count integer not null default 0,
  source text not null default 'user_suggestions',
  updated_at timestamptz not null default now(),
  constraint series_reading_corrections_series_key_not_blank check (length(btrim(series_key)) > 0),
  constraint series_reading_corrections_series_title_not_blank check (length(btrim(series_title)) > 0),
  constraint series_reading_corrections_corrected_reading_not_blank check (length(btrim(corrected_reading)) > 0)
);

alter table public.series_reading_corrections enable row level security;

create policy "series reading corrections are public readable"
  on public.series_reading_corrections
  for select
  to anon, authenticated
  using (true);

grant select on public.series_reading_corrections to anon, authenticated;
grant select, insert, update, delete on public.series_reading_corrections to service_role;

comment on table public.series_reading_corrections is 'Accepted aggregate corrections for series title readings. Raw user suggestions remain private.';
comment on column public.series_reading_corrections.corrected_reading is 'Accepted kana reading used by clients for sorting and display.';
