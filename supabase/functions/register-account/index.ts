import { createClient } from 'npm:@supabase/supabase-js@2'
import { escapeHtml, sendGmail } from '../_shared/gmail.ts'
import { COMPANY_EMAIL_GUIDANCE, isCompanyEmail, normalizeCompanyEmail } from '../_shared/company-email.ts'

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
const existingAccountMessage = 'すでにアカウント情報があります。パスワードが不明な場合は管理者へお問い合わせください。'
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
    const email = normalizeCompanyEmail(body.email)
    const name = String(body.name || '').trim()
    const password = String(body.password || '')
    const phone = String(body.phone || '').trim().slice(0, 40)

    if (!isCompanyEmail(email)) return respond({ error: COMPANY_EMAIL_GUIDANCE }, 400)
    if (!romanizedNamePattern.test(name)) return respond({ error: '氏名はローマ字で入力してください。' }, 400)
    if (password.length < 8) return respond({ error: 'パスワードは8文字以上で入力してください。' }, 400)

    const { data: existingProfiles, error: existingProfileError } = await admin
      .from('profiles')
      .select('status')
      .eq('email', email)
    if (existingProfileError) {
      console.error('existing account lookup failed', existingProfileError.code)
      return respond({ error: 'アカウント情報を確認できませんでした。時間をおいて再度お試しください。' }, 500)
    }
    if ((existingProfiles || []).some((profile) => profile.status !== 'deleted')) {
      return respond({ error: existingAccountMessage }, 409)
    }

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
      const duplicate = createError.code === 'email_exists' || /already|registered|exists/i.test(createError.message)
      const weakPassword = createError.code === 'weak_password' || /weak|guess|pwned|leaked|compromised/i.test(createError.message)
      const message = duplicate
        ? existingAccountMessage
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
    const appUrl = Deno.env.get('APP_URL') || 'https://tenx-quotation.pages.dev'
    const usersUrl = new URL('/users', appUrl).toString()
    try {
      await sendGmail({
        to: notifyEmail,
        subject: `🔔【新規アカウント登録申請】${name}_${email}`,
        text: `新規アカウント登録申請が届きました。\n氏名: ${name}\nメール: ${email}\n${phone ? `電話番号: ${phone}\n` : ''}${usersUrl}`,
        senderName: '10X Apps',
        html: `<!doctype html><html lang="ja"><body style="font-family:Arial,'Noto Sans JP',sans-serif;background:#f4f6f8;padding:24px;">
          <div style="max-width:600px;margin:auto;background:white;border:1px solid #dadce0;border-radius:12px;padding:28px;">
            <h2 style="margin:0 0 20px;">🔔 新規アカウント登録申請</h2>
            <p><strong>氏名:</strong> ${escapeHtml(name)}</p>
            <p><strong>メール:</strong> ${escapeHtml(email)}</p>
            ${phone ? `<p><strong>電話番号:</strong> ${escapeHtml(phone)}</p>` : ''}
            <p style="text-align:center;margin-top:24px;"><a href="${usersUrl}" style="display:inline-block;background:#1a73e8;color:white;text-decoration:none;font-weight:bold;padding:12px 30px;border-radius:6px;">ユーザー管理で確認する</a></p>
          </div>
        </body></html>`,
      })
    } catch (notificationError) {
      console.error('registration email notification failed', notificationError)
    }

    return respond({ ok: true })
  } catch (error) {
    console.error('register-account error', error)
    return respond({ error: '登録申請に失敗しました。' }, 500)
  }
})
