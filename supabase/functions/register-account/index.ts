import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const romanizedNamePattern = /^[A-Za-z][A-Za-z .'-]{1,99}$/
const escapeChatText = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()
    const name = String(body.name || '').trim()
    const password = String(body.password || '')
    const phone = String(body.phone || '').trim().slice(0, 40)

    if (!email.endsWith('@tenx.jp')) return respond({ error: '10Xのメールアドレスを入力してください。' }, 400)
    if (!romanizedNamePattern.test(name)) return respond({ error: '氏名はローマ字で入力してください。' }, 400)
    if (password.length < 8) return respond({ error: 'パスワードは8文字以上で入力してください。' }, 400)

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('created_at', oneHourAgo)
    if ((count || 0) >= 10) return respond({ error: '申請が集中しています。時間をおいて再度お試しください。' }, 429)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    })
    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message)
      const weakPassword = createError.code === 'weak_password' || /weak|guess|pwned|leaked|compromised/i.test(createError.message)
      const message = duplicate
        ? 'このメールアドレスは登録済みです。'
        : weakPassword
          ? 'このパスワードは推測されやすいため使用できません。英大文字・英小文字・数字・記号を組み合わせた別のパスワードを設定してください。'
          : '登録申請に失敗しました。入力内容を確認してください。'
      return respond({ error: message }, 400)
    }

    const userId = created.user.id
    const cleanup = async () => {
      await admin.from('profiles').delete().eq('id', userId)
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
    }

    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
    if (banError) {
      await cleanup()
      return respond({ error: '承認待ち状態を設定できませんでした。' }, 500)
    }

    const { error: profileError } = await admin.from('profiles').update({
      email,
      name,
      phone,
      role: null,
      trip_role: null,
      status: 'pending',
    }).eq('id', userId)
    if (profileError) {
      await cleanup()
      return respond({ error: '登録情報を保存できませんでした。' }, 500)
    }

    const notifyEmail = Deno.env.get('REGISTRATION_NOTIFY_EMAIL') || 'y.nakatani@tenx.jp'
    const { data: recipient } = await admin
      .from('profiles')
      .select('chat_webhook_url')
      .eq('email', notifyEmail)
      .maybeSingle()

    if (recipient?.chat_webhook_url) {
      const appUrl = Deno.env.get('APP_URL') || 'https://tenx-quotation.pages.dev'
      const usersUrl = new URL('/users', appUrl).toString()
      const chatResponse = await fetch(recipient.chat_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardsV2: [{
            cardId: `account-registration-${userId}`,
            card: {
              header: { title: '新規アカウント登録申請', subtitle: '10X 社内アプリ' },
              sections: [{ widgets: [
                { decoratedText: { topLabel: '氏名', text: escapeChatText(name) } },
                { decoratedText: { topLabel: 'メールアドレス', text: escapeChatText(email) } },
                ...(phone ? [{ decoratedText: { topLabel: '電話番号', text: escapeChatText(phone) } }] : []),
                { buttonList: { buttons: [{
                  text: 'ユーザー管理で確認',
                  onClick: { openLink: { url: usersUrl } },
                }] } },
              ] }],
            },
          }],
        }),
      })
      if (!chatResponse.ok) console.error('registration chat notification failed', chatResponse.status)
    } else {
      console.error('registration notification recipient has no webhook')
    }

    return respond({ ok: true })
  } catch (error) {
    console.error('register-account error', error)
    return respond({ error: '登録申請に失敗しました。' }, 500)
  }
})
