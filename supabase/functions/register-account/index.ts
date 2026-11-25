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
const registrationSources = new Map([
  ['trip', '出張申請・精算'],
  ['quotation', '見積管理'],
  ['partner_master', '取引先マスター'],
  ['portal', '社内ポータル・共通登録'],
])
const reviewUrl = 'https://tenx-account-console.pages.dev/?view=pending'

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
    // 旧フォームは出張など複数の入口で共用されていたため、未指定時は推定しない。
    const source = body.source ?? 'unknown'
    const sourceLabel = body.source == null ? '記録なし' : registrationSources.get(source)

    if (!sourceLabel) return respond({ error: '登録元を確認できません。利用するアプリから登録画面を開き直してください。' }, 400)
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

    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { name, phone },
      app_metadata: { account_registration_source: source },
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

    const notifyEmail = Deno.env.get('REGISTRATION_NOTIFY_EMAIL') || 'y.nakatani@tenx.jp'
    try {
      await sendGmail({
        to: notifyEmail,
        subject: `【新規登録申請】${name}_${sourceLabel}`,
        text: `新規アカウント登録申請が届きました。\n申請元: ${sourceLabel}\n氏名: ${name}\nメール: ${email}\n${phone ? `電話番号: ${phone}\n` : ''}${reviewUrl}`,
        senderName: '10X Apps',
        html: `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body style="font-family:Arial,'Noto Sans JP',sans-serif;background:#f4f6f8;padding:24px;">
          <div style="max-width:600px;margin:auto;background:white;border:1px solid #dadce0;border-radius:12px;padding:28px;">
            <h2 style="margin:0 0 20px;">新規アカウント登録申請</h2>
            <p><strong>申請元:</strong> ${escapeHtml(sourceLabel)}</p>
            <p><strong>氏名:</strong> ${escapeHtml(name)}</p>
            <p><strong>メール:</strong> ${escapeHtml(email)}</p>
            ${phone ? `<p><strong>電話番号:</strong> ${escapeHtml(phone)}</p>` : ''}
            <p style="text-align:center;margin-top:24px;"><a href="${reviewUrl}" style="display:inline-block;background:#1a73e8;color:white;text-decoration:none;font-weight:bold;padding:12px 30px;border-radius:6px;">アカウント管理で確認する</a></p>
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
