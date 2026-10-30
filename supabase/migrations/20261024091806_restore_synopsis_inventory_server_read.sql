-- The synopsis inventory is SECURITY INVOKER. Its server role needs the two
-- bibliographic columns it reads from wanted_manga, without write access or
-- access to unrelated wishlist/account fields. Client grants and RLS stay intact.
grant select (isbn, title) on public.wanted_manga to service_role;
