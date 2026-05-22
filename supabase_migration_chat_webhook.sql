-- profiles テーブルにGoogle Chat Webhook URLカラムを追加
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_webhook_url TEXT DEFAULT '';
