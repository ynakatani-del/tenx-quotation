-- ユーザーごとのデフォルト発行会社
-- 見積新規作成時に、この会社が初期選択される
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
