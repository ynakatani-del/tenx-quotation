-- ===================================================
-- 入社フォーム: 本人宛て確認メール用の追加
--   1. 本人メールアドレス・確認メール送信日時・配偶者情報の列を追加
--   2. メール送信用の関数 claim_onboarding_mail を追加
--      - 送信から30分以内・未送信の行だけ、1回だけ内容を返す
--      - マイナンバーは返さない。口座番号・雇用保険番号・基礎年金番号は末尾3桁のみ
--      - 呼び出し側（GAS）は anon キーだけで使える（service_role キー不要）
-- Supabase ダッシュボード → SQL Editor で実行してください
-- ===================================================

ALTER TABLE public.onboarding_submissions
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  -- 配偶者情報（扶養する場合のマイナンバーは既存の spouse_my_number）
  ADD COLUMN IF NOT EXISTS spouse_name TEXT,
  ADD COLUMN IF NOT EXISTS spouse_name_kana TEXT,
  ADD COLUMN IF NOT EXISTS spouse_birth_date DATE,
  ADD COLUMN IF NOT EXISTS spouse_gender TEXT,
  ADD COLUMN IF NOT EXISTS spouse_occupation TEXT,
  ADD COLUMN IF NOT EXISTS spouse_dependent TEXT,
  ADD COLUMN IF NOT EXISTS freee_sign_notice_acknowledged BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.mask_tail(v TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = '' THEN v
    WHEN v = '後日連絡' THEN v
    WHEN length(regexp_replace(v, '\D', '', 'g')) <= 3 THEN v
    ELSE repeat('*', length(regexp_replace(v, '\D', '', 'g')) - 3)
         || right(regexp_replace(v, '\D', '', 'g'), 3)
  END
$$;

CREATE OR REPLACE FUNCTION public.claim_onboarding_mail(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.onboarding_submissions;
BEGIN
  UPDATE public.onboarding_submissions
     SET confirmation_sent_at = NOW()
   WHERE id = p_id
     AND confirmation_sent_at IS NULL
     AND email IS NOT NULL AND email <> ''
     AND created_at > NOW() - INTERVAL '30 minutes'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
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
    'spouse_my_number_registered', (r.spouse_my_number IS NOT NULL AND r.spouse_my_number <> ''),
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
    -- 扶養家族のマイナンバーは除外
    'family_members', COALESCE((
      SELECT jsonb_agg(m - 'myNumber' - 'id') FROM jsonb_array_elements(r.family_members) m
    ), '[]'::jsonb),
    'phone_number', r.phone_number,
    'employment_insurance_number', public.mask_tail(r.employment_insurance_number),
    'basic_pension_number', public.mask_tail(r.basic_pension_number),
    'my_number_registered', (r.my_number IS NOT NULL AND r.my_number <> ''),
    'bank_name', r.bank_name, 'bank_branch_name', r.bank_branch_name,
    'bank_account_type', r.bank_account_type,
    'bank_account_number', public.mask_tail(r.bank_account_number),
    'bank_account_holder', r.bank_account_holder,
    'emergency_contacts', r.emergency_contacts,
    'has_commuting', r.has_commuting,
    'commuting_destination_name', r.commuting_destination_name,
    'commuting_destination_address', r.commuting_destination_address,
    'commuting_legs', r.commuting_legs,
    'health_cert_uploaded', r.health_cert_path IS NOT NULL,
    'profile_photo_uploaded', r.profile_photo_path IS NOT NULL,
    'freee_sign_notice_acknowledged', r.freee_sign_notice_acknowledged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_onboarding_mail(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_onboarding_mail(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_onboarding_mail(UUID) TO anon;
