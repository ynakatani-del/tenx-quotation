alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status = any (array['pending'::text, 'active'::text, 'suspended'::text, 'deleted'::text]));
