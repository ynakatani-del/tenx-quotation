import { createClient } from 'npm:@supabase/supabase-js@2'
import { escapeHtml, sendGmail } from '../_shared/gmail.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  let submissionId = ''

  try {
    const body = await req.json()
    submissionId = String(body.submission_id || '').trim()
    if (!uuidPattern.test(submissionId)) return respond({ error: 'Invalid submission ID' }, 400)

    const now = new Date()
    const submittedAfter = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
    const retryBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString()

    // 送信直後の未通知レコードだけを原子的に確保する。連打時の重複通知を防ぐ。
    const { data: submission, error: claimError } = await admin
      .from('onboarding_submissions')
      .update({
        onboarding_notification_attempted_at: now.toISOString(),
        onboarding_notification_error: null,
      })
      .eq('id', submissionId)
      .is('onboarding_notification_sent_at', null)
      .gte('created_at', submittedAfter)
      .or(`onboarding_notification_attempted_at.is.null,onboarding_notification_attempted_at.lt.${retryBefore}`)
      .select('id, last_name, first_name, employment_date')
      .maybeSingle()

    if (claimError) throw claimError
    if (!submission) return respond({ ok: true, skipped: true })

    const notifyProfileId = Deno.env.get('ONBOARDING_NOTIFY_PROFILE_ID')
    if (!notifyProfileId || !uuidPattern.test(notifyProfileId)) {
      throw new Error('ONBOARDING_NOTIFY_PROFILE_ID is not configured')
    }

    const { data: recipient, error: recipientError } = await admin
      .from('profiles')
      .select('name, email, role, status')
      .eq('id', notifyProfileId)
      .in('role', ['super_admin', 'admin'])
      .eq('status', 'active')
      .single()

    if (recipientError || !recipient?.email) throw new Error('Onboarding notification recipient is not available')

    const applicantName = `${submission.last_name || ''} ${submission.first_name || ''}`.trim() || '氏名未入力'
    const employmentDate = submission.employment_date || '未入力'
    const appUrl = (Deno.env.get('ONBOARDING_APP_URL') || 'https://tenx-joinform.pages.dev').replace(/\/$/, '')
    const adminUrl = `${appUrl}/onboarding-admin`
    const subject = `【入社フォーム提出】${applicantName}_${employmentDate}`

    await sendGmail({
      to: recipient.email,
      subject,
      text: `入社フォームが提出されました。\n氏名: ${applicantName}\n入社予定日: ${employmentDate}\n管理画面: ${adminUrl}`,
      senderName: '10X Apps',
      html: `<!doctype html><html lang="ja"><body style="font-family:Arial,'Noto Sans JP',sans-serif;background:#f4f6f8;padding:24px;color:#202124;">
        <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #dadce0;border-radius:12px;padding:28px;">
          <h2 style="margin:0 0 20px;">入社フォームが提出されました</h2>
          <p><strong>氏名:</strong> ${escapeHtml(applicantName)}</p>
          <p><strong>入社予定日:</strong> ${escapeHtml(employmentDate)}</p>
          <p style="margin:20px 0;color:#5f6368;font-size:13px;">マイナンバー、口座情報、住所などの機密情報はメール本文に記載していません。管理画面で確認してください。</p>
          <p style="text-align:center;margin-top:24px;"><a href="${adminUrl}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;font-weight:bold;padding:12px 30px;border-radius:6px;">入社管理を開く</a></p>
        </div>
      </body></html>`,
    })

    const { error: sentError } = await admin
      .from('onboarding_submissions')
      .update({
        onboarding_notification_sent_at: new Date().toISOString(),
        onboarding_notification_error: null,
      })
      .eq('id', submissionId)
    if (sentError) throw sentError

    return respond({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('send-onboarding-notification error:', message)

    if (uuidPattern.test(submissionId)) {
      await admin
        .from('onboarding_submissions')
        .update({ onboarding_notification_error: message.slice(0, 500) })
        .eq('id', submissionId)
        .is('onboarding_notification_sent_at', null)
    }

    return respond({ error: 'メール通知に失敗しました' }, 500)
  }
})
