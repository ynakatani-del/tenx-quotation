-- 顔写真URL列をprofilesテーブルに追加
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
