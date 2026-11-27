-- Never put these objects on a client-accessible Storage route.
drop policy if exists "Quotation users can read help" on storage.objects;
drop policy if exists "Require quotation access for help" on storage.objects;
drop policy if exists "No anonymous handover reads" on storage.objects;

create policy "No client reads for quotation help"
on storage.objects as restrictive for select to anon, authenticated
using (bucket_id <> 'quotation-handover');
