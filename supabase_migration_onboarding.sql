-- ===================================================
-- 入社フォーム: onboarding_submissions テーブル
-- ===================================================

CREATE TABLE public.onboarding_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'completed')),

  -- 基本情報
  last_name TEXT,
  first_name TEXT,
  last_name_kana TEXT,
  first_name_kana TEXT,
  employment_date DATE,
  birth_date DATE,
  gender TEXT,

  -- 税務関連
  has_spouse TEXT,
  widow_status TEXT,
  has_disability TEXT,
  is_working_student TEXT,

  -- 住所
  registered_postal_code TEXT,
  registered_address TEXT,
  registered_address_detail TEXT,
  same_address BOOLEAN DEFAULT TRUE,
  current_postal_code TEXT,
  current_address TEXT,
  current_address_detail TEXT,

  -- 世帯情報
  household_head TEXT,
  household_relationship TEXT,

  -- 家族構成
  has_family_members TEXT,
  family_members JSONB DEFAULT '[]',

  -- 連絡先
  phone_number TEXT,

  -- 各種番号
  employment_insurance_number TEXT,
  my_number TEXT,
  spouse_my_number TEXT,
  spouse_name TEXT,
  spouse_name_kana TEXT,
  spouse_birth_date DATE,
  spouse_gender TEXT,
  spouse_occupation TEXT,
  spouse_dependent TEXT,
  basic_pension_number TEXT,

  -- 振込口座
  bank_name TEXT,
  bank_branch_name TEXT,
  bank_account_type TEXT,
  bank_account_number TEXT,
  bank_account_holder TEXT,

  -- 緊急連絡先
  emergency_contacts JSONB DEFAULT '[]',

  -- 通勤申請
  has_commuting TEXT,
  commuting_destination_name TEXT,
  commuting_destination_address TEXT,
  commuting_legs JSONB DEFAULT '[]',

  -- ファイル（Supabase Storage パス）
  health_cert_path TEXT,
  profile_photo_path TEXT,

  -- freeeサインによる秘密保持誓約書の案内確認
  freee_sign_notice_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,

  -- 管理者メモ
  admin_notes TEXT
);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at_onboarding()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER onboarding_submissions_updated_at
  BEFORE UPDATE ON public.onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_onboarding();

-- RLS 有効化
ALTER TABLE public.onboarding_submissions ENABLE ROW LEVEL SECURITY;

-- 匿名ユーザー: INSERT のみ許可（新入社員がフォーム送信）
CREATE POLICY "anon_insert" ON public.onboarding_submissions
  FOR INSERT TO anon WITH CHECK (true);

-- 管理者・スーパー管理者: SELECT 許可
CREATE POLICY "auth_select" ON public.onboarding_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role IN ('super_admin', 'admin')
    )
  );

-- 管理者・スーパー管理者: UPDATE 許可
CREATE POLICY "auth_update" ON public.onboarding_submissions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role IN ('super_admin', 'admin')
    )
  );

-- ===================================================
-- Storage バケット: onboarding-files
-- ===================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-files', 'onboarding-files', false)
ON CONFLICT (id) DO NOTHING;

-- 匿名ユーザー: ファイルアップロードのみ許可
CREATE POLICY "anon_upload_onboarding" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'onboarding-files');

-- 管理者・スーパー管理者: ファイル閲覧許可
CREATE POLICY "auth_read_onboarding" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'onboarding-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role IN ('super_admin', 'admin')
    )
  );
