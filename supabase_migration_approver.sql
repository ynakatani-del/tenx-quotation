-- 承認申請先（指定承認者）カラムをquotationsテーブルに追加
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS requested_approver_id UUID REFERENCES auth.users(id);
