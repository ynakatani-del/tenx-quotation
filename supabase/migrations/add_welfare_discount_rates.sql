-- 法定福利費・値引きの率と手動フラグを quotations テーブルに追加
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS welfare_rate   DECIMAL(5,2) DEFAULT 16,
  ADD COLUMN IF NOT EXISTS welfare_manual BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS discount_rate  DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_manual BOOLEAN     DEFAULT FALSE;
