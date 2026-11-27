-- Provision a PRIVATE bucket named quotation-handover through Storage Dashboard.
-- This migration grants read access only; do not seed the documents in Git.
drop policy if exists "Quotation users can read help" on storage.objects;
drop policy if exists "Require quotation access for help" on storage.objects;
drop policy if exists "No anonymous handover reads" on storage.objects;

create policy "Quotation users can read help"
on storage.objects for select to authenticated
using (bucket_id = 'quotation-handover');

-- Keep the gate effective even if another permissive policy applies to this bucket.
create policy "Require quotation access for help"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'quotation-handover' or (
    (select private.is_active_company_user())
    and exists (
      select 1
      from public.profiles as p
      where p.id = (select auth.uid())
        and p.status = 'active'
        and p.quotation_suspended is false
        and (
          (objects.name = 'guide.json' and p.role in ('general', 'admin', 'maintenance_admin', 'super_admin'))
          or (objects.name = 'handover.json' and p.role = 'super_admin')
        )
    )
  )
);

create policy "No anonymous handover reads"
on storage.objects as restrictive for select to anon
using (bucket_id <> 'quotation-handover');
