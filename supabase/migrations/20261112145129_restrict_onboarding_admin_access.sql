drop policy if exists "anon_insert_onboarding" on public.onboarding_submissions;

drop policy if exists "auth_select" on public.onboarding_submissions;
drop policy if exists "auth_update" on public.onboarding_submissions;

create policy "auth_select"
on public.onboarding_submissions
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('super_admin', 'admin')
  )
);

create policy "auth_update"
on public.onboarding_submissions
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('super_admin', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('super_admin', 'admin')
  )
);

drop policy if exists "auth_read_onboarding" on storage.objects;
drop policy if exists "authenticated_read_onboarding" on storage.objects;

create policy "auth_read_onboarding"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'onboarding-files'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('super_admin', 'admin')
  )
);
