-- 顧客直接入力用カラムをquotationsテーブルに追加
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_name TEXT;
