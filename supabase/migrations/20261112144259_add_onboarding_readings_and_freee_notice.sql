alter table if exists public.onboarding_submissions
  add column if not exists email text,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists spouse_name text,
  add column if not exists spouse_name_kana text,
  add column if not exists spouse_birth_date date,
  add column if not exists spouse_gender text,
  add column if not exists spouse_occupation text,
  add column if not exists spouse_dependent text,
  add column if not exists freee_sign_notice_acknowledged boolean not null default false;

create or replace function public.mask_tail(v text)
returns text
language sql
immutable
as $$
  select case
    when v is null or v = '' then v
    when v = '後日連絡' then v
    when length(regexp_replace(v, '\D', '', 'g')) <= 3 then v
    else repeat('*', length(regexp_replace(v, '\D', '', 'g')) - 3)
         || right(regexp_replace(v, '\D', '', 'g'), 3)
  end
$$;

create or replace function public.claim_onboarding_mail(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.onboarding_submissions;
begin
  update public.onboarding_submissions
     set confirmation_sent_at = now()
   where id = p_id
     and confirmation_sent_at is null
     and email is not null and email <> ''
     and created_at > now() - interval '30 minutes'
  returning * into r;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', r.id,
    'created_at', r.created_at,
    'email', r.email,
    'last_name', r.last_name, 'first_name', r.first_name,
    'last_name_kana', r.last_name_kana, 'first_name_kana', r.first_name_kana,
    'employment_date', r.employment_date, 'birth_date', r.birth_date, 'gender', r.gender,
    'has_spouse', r.has_spouse, 'widow_status', r.widow_status,
    'spouse_name', r.spouse_name, 'spouse_name_kana', r.spouse_name_kana,
    'spouse_birth_date', r.spouse_birth_date,
    'spouse_gender', r.spouse_gender, 'spouse_occupation', r.spouse_occupation,
    'spouse_dependent', r.spouse_dependent,
    'spouse_my_number_registered', (r.spouse_my_number is not null and r.spouse_my_number <> ''),
    'has_disability', r.has_disability, 'is_working_student', r.is_working_student,
    'registered_postal_code', r.registered_postal_code,
    'registered_address', r.registered_address,
    'registered_address_detail', r.registered_address_detail,
    'same_address', r.same_address,
    'current_postal_code', r.current_postal_code,
    'current_address', r.current_address,
    'current_address_detail', r.current_address_detail,
    'household_head', r.household_head, 'household_relationship', r.household_relationship,
    'has_family_members', r.has_family_members,
    'family_members', coalesce((
      select jsonb_agg(m - 'myNumber' - 'id') from jsonb_array_elements(r.family_members) m
    ), '[]'::jsonb),
    'phone_number', r.phone_number,
    'employment_insurance_number', public.mask_tail(r.employment_insurance_number),
    'basic_pension_number', public.mask_tail(r.basic_pension_number),
    'my_number_registered', (r.my_number is not null and r.my_number <> ''),
    'bank_name', r.bank_name, 'bank_branch_name', r.bank_branch_name,
    'bank_account_type', r.bank_account_type,
    'bank_account_number', public.mask_tail(r.bank_account_number),
    'bank_account_holder', r.bank_account_holder,
    'emergency_contacts', r.emergency_contacts,
    'has_commuting', r.has_commuting,
    'commuting_destination_name', r.commuting_destination_name,
    'commuting_destination_address', r.commuting_destination_address,
    'commuting_legs', r.commuting_legs,
    'health_cert_uploaded', r.health_cert_path is not null,
    'profile_photo_uploaded', r.profile_photo_path is not null,
    'freee_sign_notice_acknowledged', r.freee_sign_notice_acknowledged
  );
end;
$$;

revoke all on function public.claim_onboarding_mail(uuid) from public;
grant execute on function public.claim_onboarding_mail(uuid) to anon, authenticated;
