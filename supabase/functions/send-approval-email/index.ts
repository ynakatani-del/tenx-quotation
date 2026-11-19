import { createClient } from 'npm:@supabase/supabase-js@2'
import { escapeHtml, sendGmail } from '../_shared/gmail.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { quotation_id, screenshot_base64, pdf_base64, pdf_filename } = await req.json()
    if (!quotation_id || !screenshot_base64 || !pdf_base64) {
      return jsonResponse({ error: 'Quotation image and PDF are required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: q, error: quotationError } = await supabase
      .from('quotations')
      .select('id, title, quotation_number, issue_date, requested_approver_id, profiles!quotations_created_by_fkey(name)')
      .eq('id', quotation_id)
      .single()

    if (quotationError || !q) return jsonResponse({ error: 'Quotation not found' }, 404)
    if (!q.requested_approver_id) return jsonResponse({ error: 'No approver specified' }, 400)

    const { data: approver } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', q.requested_approver_id)
      .single()

    if (!approver?.email) return jsonResponse({ error: 'Approver email not found' }, 400)

    const approveToken = crypto.randomUUID()
    const rejectToken = crypto.randomUUID()
    const { error: tokenError } = await supabase.from('quotations').update({
      approve_token: approveToken,
      reject_token: rejectToken,
    }).eq('id', quotation_id)
    if (tokenError) throw tokenError

    const appUrl = (Deno.env.get('APP_URL') || 'https://tenx-quotation.pages.dev').replace(/\/$/, '')
    const detailUrl = `${appUrl}/quotations/${q.id}/print`
    const approveUrl = `${appUrl}/approval-action?token=${approveToken}&action=approve`
    const rejectUrl = `${appUrl}/approval-action?token=${rejectToken}&action=reject`
    const requesterName = (q as any).profiles?.name || '担当者'
    const title = q.title || q.quotation_number || '見積書'
    const subject = `📋【見積承認依頼】${requesterName}_${title}`
    const safeRequester = escapeHtml(requesterName)
    const safeTitle = escapeHtml(title)

    const html = `<!doctype html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,'Noto Sans JP',sans-serif;color:#202124;">
  <div style="max-width:840px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:12px;padding:24px;">
    <p style="margin:0 0 18px;font-size:15px;"><strong>${safeRequester}</strong>さんから見積承認依頼が届きました。見積書をご確認ください。</p>
    <p style="margin:0 0 16px;color:#555;font-size:13px;">見積書PDFを添付しています。本文でも全ページを確認できます。</p>
    <a href="${detailUrl}" style="text-decoration:none;">
      <img src="cid:quotation-preview" alt="${safeTitle}" style="display:block;width:100%;max-width:796px;height:auto;margin:0 auto;border:1px solid #dadce0;">
    </a>
    <div style="text-align:center;margin:24px 0 18px;">
      <a href="${detailUrl}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;font-weight:bold;padding:13px 42px;border-radius:6px;">見積の詳細を確認する</a>
    </div>
    <div style="text-align:center;margin:0 0 8px;">
      <a href="${approveUrl}" style="display:inline-block;background:#188038;color:#fff;text-decoration:none;font-weight:bold;padding:12px 34px;border-radius:6px;margin:4px 6px;">承認する</a>
      <a href="${rejectUrl}" style="display:inline-block;background:#d93025;color:#fff;text-decoration:none;font-weight:bold;padding:12px 34px;border-radius:6px;margin:4px 6px;">差し戻す</a>
    </div>
    <p style="margin:14px 0 0;color:#777;font-size:12px;text-align:center;">承認・差し戻しボタンは一度のみ有効です。</p>
  </div>
</body></html>`

    await sendGmail({
      to: approver.email,
      subject,
      text: `${requesterName}さんから見積承認依頼が届きました。\n詳細: ${detailUrl}`,
      html,
      senderName: '10X RFQ',
      inlineImages: [{
        cid: 'quotation-preview',
        filename: 'quotation-preview.jpg',
        mimeType: 'image/jpeg',
        base64: screenshot_base64,
      }],
      attachments: [{
        filename: pdf_filename || `${q.issue_date || ''}_${title}_10X.pdf`,
        mimeType: 'application/pdf',
        base64: pdf_base64,
      }],
    })

    return jsonResponse({ success: true, to: approver.email })
  } catch (error) {
    console.error('send-approval-email error:', error)
    return jsonResponse({ error: String(error) }, 500)
  }
})
