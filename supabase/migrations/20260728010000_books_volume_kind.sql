alter table public.books
  add column if not exists volume_kind text not null default 'main'
  check (volume_kind in ('main', 'extra'));

comment on column public.books.volume_kind is 'main: 通常巻。extra: アンソロジー、番外編、ファンブックなど刊行数や抜け巻計算に含めない関連巻。';
