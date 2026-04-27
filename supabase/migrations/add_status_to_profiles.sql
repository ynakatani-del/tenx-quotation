-- profilesテーブルにstatusカラムを追加
-- 値: 'active'（有効）| 'suspended'（一時停止）| 'deleted'（削除済み）
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'deleted'));
