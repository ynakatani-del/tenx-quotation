-- =============================================
-- マイグレーション: 見積リビジョン管理
-- Supabaseの「SQL Editor」で実行してください
-- =============================================

-- quotationsテーブルに列を追加
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS base_number TEXT,
  ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_latest_revision BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS source_quotation_id UUID REFERENCES quotations(id);

-- 既存データのbase_number・revision_numberを初期化
UPDATE quotations
  SET base_number = quotation_number,
      revision_number = 1,
      is_latest_revision = true
  WHERE base_number IS NULL;

-- インデックス追加（採番クエリの高速化）
CREATE INDEX IF NOT EXISTS idx_quotations_base_number ON quotations(base_number);
CREATE INDEX IF NOT EXISTS idx_quotations_is_latest ON quotations(is_latest_revision);

-- fiscal_month_start列がなければ追加
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS fiscal_month_start INTEGER DEFAULT 4;
