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
    const { quotation_id, screenshot_base64 } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch quotation with relations
    const { data: q, error: qErr } = await supabase
      .from('quotations')
      .select('*, customers(name), companies(name), profiles!quotations_created_by_fkey(name)')
      .eq('id', quotation_id)
      .single()

    if (qErr || !q) {
      return new Response(JSON.stringify({ error: 'Quotation not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!q.requested_approver_id) {
      return new Response(JSON.stringify({ error: 'No approver specified' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get approver email from auth.users
    const { data: { user: approverUser } } = await supabase.auth.admin.getUserById(q.requested_approver_id)
    if (!approverUser?.email) {
      return new Response(JSON.stringify({ error: 'Approver email not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get approver profile name
    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', q.requested_approver_id)
      .single()

    // Fetch items to compute purchase total
    const { data: items } = await supabase
      .from('quotation_items')
      .select('purchase_quantity, purchase_unit_price')
      .eq('quotation_id', quotation_id)

    const purchaseTotal = (items || []).reduce((s: number, i: any) =>
      s + Number(i.purchase_quantity || 0) * Number(i.purchase_unit_price || 0), 0)

    const taxExcl = Number(q.total || 0) - Number(q.tax_amount || 0)
    const profit = taxExcl - purchaseTotal
    const profitRate = taxExcl > 0 ? Math.round(profit / taxExcl * 100 * 10) / 10 : 0

    // Generate one-time tokens
    const approveToken = crypto.randomUUID()
    const rejectToken = crypto.randomUUID()

    await supabase.from('quotations').update({
      approve_token: approveToken,
      reject_token: rejectToken,
    }).eq('id', quotation_id)

    // Upload screenshot to Storage
    let screenshotUrl = ''
    if (screenshot_base64) {
      try {
        // Ensure bucket exists
        await supabase.storage.createBucket('quotation-previews', { public: true }).catch(() => {})

        const byteArray = Uint8Array.from(atob(screenshot_base64), (c) => c.charCodeAt(0))
        const fileName = `${quotation_id}-${Date.now()}.jpg`
        const { data: uploadData } = await supabase.storage
          .from('quotation-previews')
          .upload(fileName, byteArray, { contentType: 'image/jpeg', upsert: true })

        if (uploadData) {
          const { data: urlData } = supabase.storage.from('quotation-previews').getPublicUrl(fileName)
          screenshotUrl = urlData?.publicUrl || ''
        }
      } catch (uploadErr) {
        console.error('Screenshot upload failed:', uploadErr)
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const appUrl = Deno.env.get('APP_URL') || ''
    const approveUrl = `${appUrl}/approval-action?token=${approveToken}&action=approve`
    const rejectUrl = `${appUrl}/approval-action?token=${rejectToken}&action=reject`

    const customerName = q.customers?.name || q.customer_name || '―'
    const requesterName = (q as any).profiles?.name || '担当者'
    const approverName = approverProfile?.name || '承認者'
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'noreply@example.com'

    const subject = `【見積承認依頼】${customerName}_${q.title}_¥${fmt(taxExcl)}`

    const profitColor = profit >= 0 ? '#15803d' : '#dc2626'
    const rateColor = profitRate >= 0 ? '#15803d' : '#dc2626'

    const emailHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- ヘッダー -->
  <div style="background:#1e40af;padding:28px 32px;">
    <h1 style="color:white;margin:0;font-size:20px;font-weight:bold;letter-spacing:0.5px;">📋 見積承認依頼</h1>
    <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px;">${q.companies?.name || ''}</p>
  </div>

  <div style="padding:32px;">
    <!-- 宛先 -->
    <p style="margin:0 0 4px;font-size:17px;font-weight:bold;color:#1f2937;">${approverName} 様</p>
    <p style="margin:0 0 28px;font-size:14px;color:#374151;line-height:1.7;">
      <strong style="color:#1e40af;">${requesterName}</strong> さんから見積の承認依頼が届いています。<br>
      内容をご確認のうえ、承認または差し戻しをお願いいたします。
    </p>

    <!-- 見積詳細 -->
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:28px;">
      <h2 style="font-size:13px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">見積詳細</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:7px 0;color:#64748b;width:42%;vertical-align:top;">取引先</td>
          <td style="padding:7px 0;color:#1e293b;font-weight:600;">${customerName}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#64748b;">案件名</td>
          <td style="padding:7px 0;color:#1e293b;font-weight:600;">${q.title}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:10px 0 5px;color:#64748b;">見積金額（税抜）</td>
          <td style="padding:10px 0 5px;color:#1d4ed8;font-weight:bold;font-size:18px;">¥${fmt(taxExcl)}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b;">仕入金額</td>
          <td style="padding:5px 0;color:#374151;">¥${fmt(purchaseTotal)}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b;">利益</td>
          <td style="padding:5px 0;color:${profitColor};font-weight:600;">¥${fmt(profit)}</td>
        </tr>
        <tr>
          <td style="padding:5px 0 10px;color:#64748b;">利益率</td>
          <td style="padding:5px 0 10px;color:${rateColor};font-weight:600;">${profitRate.toFixed(1)}%</td>
        </tr>
      </table>
    </div>

    ${screenshotUrl ? `
    <!-- 見積プレビュー -->
    <div style="margin-bottom:28px;">
      <h2 style="font-size:13px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">見積プレビュー</h2>
      <img src="${screenshotUrl}" alt="見積プレビュー" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;display:block;">
    </div>
    ` : ''}

    <!-- アクションボタン -->
    <div style="background:#f8fafc;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 20px;font-size:13px;color:#64748b;">以下のボタンをクリックするだけで承認・差し戻しが完了します</p>
      <div>
        <a href="${approveUrl}"
          style="display:inline-block;background:#16a34a;color:white;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;margin:4px 8px;letter-spacing:0.3px;">
          ✓ 承認する
        </a>
        <a href="${rejectUrl}"
          style="display:inline-block;background:#dc2626;color:white;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;margin:4px 8px;letter-spacing:0.3px;">
          ↩ 差し戻す
        </a>
      </div>
    </div>

    ${appUrl ? `
    <p style="text-align:center;margin:0 0 24px;">
      <a href="${appUrl}/quotations/${q.id}/edit" style="color:#3b82f6;font-size:13px;text-decoration:none;">この見積書を確認する →</a>
    </p>
    ` : ''}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;">
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;line-height:1.6;">
      このメールはシステムから自動送信されています。返信は不要です。<br>
      承認・差し戻しのボタンは一度のみ有効です。
    </p>
  </div>
</div>
</body>
</html>`

    // Send via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [approverUser.email],
        subject,
        html: emailHtml,
      }),
    })

    if (!emailRes.ok) {
      const errText = await emailRes.text()
      console.error('Resend error:', errText)
      return new Response(JSON.stringify({ error: 'Email send failed', detail: errText }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, to: approverUser.email }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('send-approval-email error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
