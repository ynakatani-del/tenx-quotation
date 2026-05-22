-- profiles テーブルにオフィス名カラムを追加
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS office_name TEXT DEFAULT '';

-- companies テーブルにオフィス選択肢カラムを追加
ALTER TABLE companies ADD COLUMN IF NOT EXISTS office_options JSONB DEFAULT '[]';
