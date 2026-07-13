-- handle_new_user is a trigger function only; it must not be directly callable.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
