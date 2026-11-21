-- Company-domain signup is enforced by the Auth hook. This migration adds the
-- same active-company requirement to quotation Data API access so an existing,
-- external, pending, suspended, or deleted account cannot rely on a valid JWT.

do $$
begin
  if to_regprocedure('private.is_active_company_user()') is null then
    raise exception 'private.is_active_company_user() must exist before this migration';
  end if;
end
$$;

alter policy companies_select on public.companies
  using ((select private.is_active_company_user()));
alter policy companies_insert on public.companies
  with check (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );
alter policy companies_update on public.companies
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );
alter policy companies_delete on public.companies
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'super_admin'
    )
  );

alter policy customers_select on public.customers
  using ((select private.is_active_company_user()));

-- Keep the existing quotation-admin permissions on the shared customers table,
-- but require an active company account in every permissive legacy policy.
alter policy customers_write on public.customers
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  )
  with check (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );
alter policy customers_insert on public.customers
  with check (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );
alter policy customers_update on public.customers
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );
alter policy customers_delete on public.customers
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = any (array['super_admin'::text, 'admin'::text])
    )
  );

alter policy profiles_update on public.profiles
  using (
    (select private.is_active_company_user())
    and (
      id = (select auth.uid())
      or acct_is_quotation_admin((select auth.uid()))
      or acct_is_trip_admin((select auth.uid()))
    )
  )
  with check (
    (select private.is_active_company_user())
    and (
      id = (select auth.uid())
      or acct_is_quotation_admin((select auth.uid()))
      or acct_is_trip_admin((select auth.uid()))
    )
  );
alter policy profiles_select on public.profiles
  using ((select private.is_active_company_user()));

alter policy quotations_select on public.quotations
  using (
    (select private.is_active_company_user())
    and (
      can_view_all_quotations()
      or created_by = (select auth.uid())
      or requested_approver_id = (select auth.uid())
      or approved_by = (select auth.uid())
    )
  );
alter policy quotations_insert on public.quotations
  with check (
    (select private.is_active_company_user())
    and created_by = (select auth.uid())
  );
alter policy quotations_insert_super_admin on public.quotations
  with check (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'super_admin'
    )
  );
alter policy quotations_update on public.quotations
  using (
    (select private.is_active_company_user())
    and (
      created_by = (select auth.uid())
      or exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'super_admin'
      )
      or exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'admin'
          and (profiles.view_scope = 'all' or requested_approver_id = (select auth.uid()))
      )
    )
  );
alter policy quotations_delete on public.quotations
  using (
    (select private.is_active_company_user())
    and (
      created_by = (select auth.uid())
      or exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.role = 'super_admin'
      )
    )
  );

alter policy quotation_items_all on public.quotation_items
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
    )
  )
  with check (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
    )
  );

alter policy settings_select on public.settings
  using ((select private.is_active_company_user()));
alter policy settings_update on public.settings
  using (
    (select private.is_active_company_user())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'super_admin'
    )
  );

alter policy unit_price_tables_all on public.unit_price_tables
  using ((select private.is_active_company_user()))
  with check ((select private.is_active_company_user()));
alter policy unit_prices_all on public.unit_prices
  using ((select private.is_active_company_user()))
  with check ((select private.is_active_company_user()));

alter policy "authenticated users can read supplier_unit_prices" on public.supplier_unit_prices
  using ((select private.is_active_company_user()));
alter policy "authenticated users can insert supplier_unit_prices" on public.supplier_unit_prices
  with check ((select private.is_active_company_user()));
alter policy "authenticated users can update supplier_unit_prices" on public.supplier_unit_prices
  using ((select private.is_active_company_user()))
  with check ((select private.is_active_company_user()));
alter policy "authenticated users can delete supplier_unit_prices" on public.supplier_unit_prices
  using ((select private.is_active_company_user()));
