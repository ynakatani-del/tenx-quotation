import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 管理者操作は Supabase Edge Functions 経由で行う。
// VITE_ 変数はブラウザーに配信されるため、秘密鍵は絶対に追加しない。
