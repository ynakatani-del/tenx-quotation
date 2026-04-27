import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return respond({ error: 'Unauthorized' }, 401)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 呼び出し元のJWTを検証
    const { data: { user: callerUser }, error: userErr } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userErr || !callerUser) return respond({ error: 'Unauthorized' }, 401)

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (callerProfile?.role !== 'super_admin') {
      return respond({ error: 'Forbidden' }, 403)
    }

    const { action, userId, password } = await req.json()
    if (!userId) return respond({ error: 'userId required' }, 400)

    // 自分自身への操作は不可
    if (userId === callerUser.id) return respond({ error: 'Cannot operate on self' }, 400)

    // 対象ユーザーのプロファイル取得
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()

    // 他の特権管理者への操作は不可
    if (targetProfile?.role === 'super_admin') {
      return respond({ error: 'Cannot operate on super admin' }, 403)
    }

    switch (action) {
      case 'change-password': {
        if (!password || password.length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400)
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
        if (error) return respond({ error: error.message }, 400)
        return respond({ ok: true })
      }

      case 'suspend': {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })
        if (authErr) return respond({ error: authErr.message }, 400)
        const { error: dbErr } = await supabaseAdmin
          .from('profiles')
          .update({ status: 'suspended' })
          .eq('id', userId)
        if (dbErr) return respond({ error: dbErr.message }, 400)
        return respond({ ok: true })
      }

      case 'unsuspend': {
        const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        })
        if (authErr) return respond({ error: authErr.message }, 400)
        const { error: dbErr } = await supabaseAdmin
          .from('profiles')
          .update({ status: 'active' })
          .eq('id', userId)
        if (dbErr) return respond({ error: dbErr.message }, 400)
        return respond({ ok: true })
      }

      case 'delete': {
        // プロファイルをdeleted状態に（集計でunknown表示のために保持）
        const { error: dbErr } = await supabaseAdmin
          .from('profiles')
          .update({ status: 'deleted' })
          .eq('id', userId)
        if (dbErr) return respond({ error: dbErr.message }, 400)
        // 認証ユーザーを削除（ログイン不可に）
        const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (authErr) return respond({ error: authErr.message }, 400)
        return respond({ ok: true })
      }

      default:
        return respond({ error: 'Unknown action' }, 400)
    }
  } catch (err) {
    console.error('admin-user-action error:', err)
    return respond({ error: String(err) }, 500)
  }
})
