-- 単価の「最終更新者」と「直前の値（1世代）」を記録
-- 最終更新者（誰が最後に編集したか）
ALTER TABLE unit_prices
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 直前の値のスナップショット（元に戻す用）
ALTER TABLE unit_prices
  ADD COLUMN IF NOT EXISTS prev_data JSONB;
