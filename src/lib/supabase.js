import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 管理者操作（ユーザー作成・停止・削除等）は Edge Function `admin-user-action` /
// `account-admin` 経由で行う。service_role キーはフロントエンドに置かないこと
// （VITE_ 変数はビルド成果物に埋め込まれ、ブラウザから読めるため）。
