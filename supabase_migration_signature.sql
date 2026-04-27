-- サインURL列をprofilesテーブルに追加
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- Supabase StorageにSignaturesバケットを作成（手動で行う場合はコメントを外す）
-- INSERT INTO storage.buckets (id, name, public) VALUES ('signatures', 'signatures', true)
-- ON CONFLICT (id) DO NOTHING;
