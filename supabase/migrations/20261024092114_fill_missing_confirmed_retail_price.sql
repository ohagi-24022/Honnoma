-- The server may supplement a missing retail price; personal purchase prices
-- and confirmed identity/edition/cover/description are never updated here.
create function public.fill_missing_book_retail_price(p_isbn text,p_price integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 if p_isbn !~ '^(978|979)[0-9]{10}$' or p_price is null or p_price<=0 or p_price>1000000 then
  raise exception 'Invalid retail price';
 end if;
 update public.confirmed_book_metadata set metadata=metadata||jsonb_build_object(
  'list_price',p_price,'price_source','rakuten','price_fetched_at',now())
 where normalized_isbn=p_isbn and enabled and nullif(metadata->>'list_price','') is null;
 update public.book_metadata_cache set list_price=p_price,price_source='rakuten',price_fetched_at=now(),updated_at=now()
 where normalized_isbn=p_isbn and list_price is null;
 get diagnostics affected=row_count;
 return affected>0;
end $$;
revoke all on function public.fill_missing_book_retail_price(text,integer) from public,anon,authenticated;
grant execute on function public.fill_missing_book_retail_price(text,integer) to service_role;
