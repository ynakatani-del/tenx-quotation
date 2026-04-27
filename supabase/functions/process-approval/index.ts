import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmt(n: number) {
  return Number(n).toLocaleString('ja-JP')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, action, comment } = await req.json()

    if (!token || !['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'invalid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const tokenCol = action === 'approve' ? 'approve_token' : 'reject_token'
    const { data: q } = await supabase
      .from('quotations')
      .select('id, status, title, total, tax_amount, created_by, requested_approver_id, customer_name, customers(name), companies(name)')
      .eq(tokenCol, token)
      .single()

    if (!q) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if ((q as any).status === 'approved') {
      return new Response(JSON.stringify({ error: 'already_approved' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if ((q as any).status === 'rejected') {
      return new Response(JSON.stringify({ error: 'already_rejected' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    await supabase.from('quotations').update({
      status: newStatus,
      approve_token: null,
      reject_token: null,
    }).eq('id', (q as any).id)

    // Get approver name
    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', (q as any).requested_approver_id)
      .single()

    // Get requester email
    const { data: { user: requesterUser } } = await supabase.auth.admin.getUserById((q as any).created_by)

    console.log('requester email:', requesterUser?.email, '| action:', action)
    if (requesterUser?.email) {
      const approverName = (approverProfile as any)?.name || '承認者'
      const customerName = (q as any).customers?.name || (q as any).customer_name || '―'
      const taxExcl = Number((q as any).total || 0) - Number((q as any).tax_amount || 0)
      const isApprove = action === 'approve'
      const actionLabel = isApprove ? '承認済み' : '差し戻し'
      const subject = `【${actionLabel}】${customerName}_${(q as any).title}_¥${fmt(taxExcl)}`
      const actionMsg = isApprove
        ? `${approverName}さんから承認されました。`
        : `${approverName}さんから差し戻しされました。`
      const appUrl = Deno.env.get('APP_URL') || ''
      const statusColor = isApprove ? '#16a34a' : '#dc2626'
      const iconBg = isApprove ? '#dcfce7' : '#fee2e2'
      const icon = isApprove ? '✓' : '✕'

      const emailHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:${statusColor};padding:28px 32px;">
    <h1 style="color:white;margin:0;font-size:20px;font-weight:bold;">【${actionLabel}】見積の処理結果</h1>
  </div>
  <div style="padding:32px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:72px;height:72px;border-radius:50%;background:${iconBg};display:inline-block;text-align:center;line-height:72px;font-size:30px;color:${statusColor};font-weight:bold;margin-bottom:16px;">${icon}</div>
      <p style="font-size:18px;font-weight:bold;color:#1f2937;margin:0;">${actionMsg}</p>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h2 style="font-size:13px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">見積詳細</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:7px 0;color:#64748b;width:42%;">取引先</td>
          <td style="padding:7px 0;color:#1e293b;font-weight:600;">${customerName}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#64748b;">案件名</td>
          <td style="padding:7px 0;color:#1e293b;font-weight:600;">${(q as any).title}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:10px 0 5px;color:#64748b;">見積金額（税抜）</td>
          <td style="padding:10px 0 5px;color:#1d4ed8;font-weight:bold;font-size:18px;">¥${fmt(taxExcl)}</td>
        </tr>
      </table>
    </div>

    ${comment ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="font-size:12px;font-weight:bold;color:#92400e;margin:0 0 6px;">コメント</p>
      <p style="font-size:14px;color:#1f2937;margin:0;line-height:1.7;">${comment.replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}

    ${appUrl ? `
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${appUrl}/dashboard/login"
        style="display:inline-block;background:#1e40af;color:white;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;">
        ログインして確認する
      </a>
    </div>
    ` : ''}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;">
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;line-height:1.6;">
      このメールはシステムから自動送信されています。返信は不要です。
    </p>
  </div>
</div>
</body>
</html>`

      const resendKey = Deno.env.get('RESEND_API_KEY')
      if (resendKey) {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: Deno.env.get('FROM_EMAIL') || 'noreply@example.com',
            to: [requesterUser.email],
            subject,
            html: emailHtml,
          }),
        })
        if (!emailRes.ok) {
          const errText = await emailRes.text()
          console.error('Resend error (notify):', errText)
        }
      } else {
        console.error('RESEND_API_KEY not set')
      }
    } else {
      console.error('requesterUser not found for created_by:', (q as any).created_by)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('process-approval error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
