-- Run against the migrated database. No data changes are retained.
begin;
set local role service_role;
do $$
declare inventory jsonb; size integer; state text;
begin
 foreach size in array array[10,30,50,100] loop
  inventory := public.admin_book_synopsis_inventory('', 'all',size,1);
  if jsonb_typeof(inventory->'rows') <> 'array'
   or (inventory->>'count')::integer < 0
   or jsonb_array_length(inventory->'rows') > size then
   raise exception 'Invalid synopsis inventory page for size %',size;
  end if;
 end loop;
 foreach state in array array['acquired','missing','failed','unfetched'] loop
  inventory := public.admin_book_synopsis_inventory('',state,10,999999);
  if (inventory->>'page')::integer < 1 or jsonb_typeof(inventory->'rows') <> 'array' then
   raise exception 'Invalid synopsis state filter %',state;
  end if;
 end loop;
 inventory := public.admin_book_synopsis_inventory('9784757560062','all',10,1);
 if exists(select 1 from jsonb_array_elements(inventory->'rows') r where r->>'isbn' <> '9784757560062') then
  raise exception 'ISBN filter returned an unrelated book';
 end if;
end $$;
reset role;
do $$
begin
 if not has_column_privilege('service_role','public.wanted_manga','isbn','SELECT')
  or not has_column_privilege('service_role','public.wanted_manga','title','SELECT') then
  raise exception 'Missing server bibliographic read grant';
 end if;
 if has_column_privilege('service_role','public.wanted_manga','user_id','SELECT')
  or has_table_privilege('service_role','public.wanted_manga','UPDATE') then
  raise exception 'Wishlist grant is broader than the inventory needs';
 end if;
 if has_function_privilege('anon','public.admin_book_synopsis_inventory(text,text,integer,integer)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_book_synopsis_inventory(text,text,integer,integer)','EXECUTE') then
  raise exception 'Administrative inventory must not be exposed to app clients';
 end if;
end $$;
select 'Server inventory pages, filters, ISBN isolation and least-privilege grants: passed' as verification;
rollback;
