-- Publisher: https://www.dokidokivisual.com/comics/5370/
-- Bind the audited account to __TARGET_USER_ID__ when executing.
begin;
do $$ declare affected integer; begin
  update public.books b set volume_kind='extra', series_title=(
    select series_title from public.books where user_id=b.user_id and isbn='9784832242364' and publisher='芳文社' limit 1
  ) where b.user_id='__TARGET_USER_ID__'::uuid and b.isbn='9784832273146'
    and b.publisher='芳文社' and b.title like '%おたより%' and b.volume_kind='main'
    and exists(select 1 from public.books m where m.user_id=b.user_id and m.isbn='9784832242364' and m.publisher='芳文社');
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Expected one verified companion'; end if;
end $$;
commit;

-- After applying book_format_filtering, the same verified publication can be classified:
update public.books set book_format='comic'
where user_id='__TARGET_USER_ID__'::uuid and isbn='9784832273146'
  and publisher='芳文社' and volume_kind='extra' and book_format is null;
