-- 承認トークンカラムをquotationsテーブルに追加
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approve_token UUID;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reject_token UUID;

-- Storageバケット作成（見積プレビュー画像用）
INSERT INTO storage.buckets (id, name, public)
VALUES ('quotation-previews', 'quotation-previews', true)
ON CONFLICT (id) DO NOTHING;

-- Storageポリシー（認証済みユーザーがアップロード可能、全員が読み取り可能）
CREATE POLICY IF NOT EXISTS "quotation-previews public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quotation-previews');

CREATE POLICY IF NOT EXISTS "quotation-previews authenticated upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'quotation-previews');
