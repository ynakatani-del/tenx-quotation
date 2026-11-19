import { escapeHtml, sendGmail } from './gmail.ts'

export async function sendQuotationResultEmail(
  supabase: any,
  quotationId: string,
  action: 'approve' | 'reject',
  comment: string | null | undefined,
  approverId: string | null | undefined,
) {
  const { data: quotation, error } = await supabase
    .from('quotations')
    .select('id, title, quotation_number, created_by')
    .eq('id', quotationId)
    .single()
  if (error || !quotation) throw new Error('Quotation not found')

  const [{ data: requester }, { data: approver }] = await Promise.all([
    supabase.from('profiles').select('name, email').eq('id', quotation.created_by).single(),
    approverId
      ? supabase.from('profiles').select('name').eq('id', approverId).single()
      : Promise.resolve({ data: null }),
  ])
  if (!requester?.email) throw new Error('Requester email not found')

  const isApproved = action === 'approve'
  const statusLabel = isApproved ? '見積承認済' : '見積差し戻し'
  const requesterName = requester.name || '担当者'
  const approverName = approver?.name || '承認者'
  const title = quotation.title || quotation.quotation_number || '見積書'
  const appUrl = (Deno.env.get('APP_URL') || 'https://tenx-quotation.pages.dev').replace(/\/$/, '')
  const detailUrl = isApproved
    ? `${appUrl}/quotations/${quotation.id}/print`
    : `${appUrl}/quotations/${quotation.id}/edit`
  const resultText = isApproved
    ? `${approverName}さんが見積を承認しました。`
    : `${approverName}さんが見積を差し戻しました。`
  const safeComment = comment ? escapeHtml(comment).replaceAll('\n', '<br>') : ''

  const html = `<!doctype html>
<html lang="ja"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,'Noto Sans JP',sans-serif;color:#202124;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dadce0;border-radius:12px;padding:28px;">
    <h2 style="margin:0 0 16px;font-size:20px;">【${statusLabel}】</h2>
    <p style="margin:0 0 10px;font-size:15px;">${escapeHtml(requesterName)}さん</p>
    <p style="margin:0 0 18px;font-size:15px;">${escapeHtml(resultText)}</p>
    <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="font-size:12px;color:#666;margin-bottom:4px;">件名</div>
      <div style="font-size:15px;font-weight:bold;">${escapeHtml(title)}</div>
      ${safeComment ? `<div style="font-size:12px;color:#666;margin:14px 0 4px;">コメント</div><div style="font-size:14px;">${safeComment}</div>` : ''}
    </div>
    <div style="text-align:center;">
      <a href="${detailUrl}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;font-weight:bold;padding:13px 38px;border-radius:6px;">見積の詳細を確認する</a>
    </div>
  </div>
</body></html>`

  await sendGmail({
    to: requester.email,
    subject: `【${statusLabel}】${requesterName}_${title}`,
    text: `${resultText}\n${comment ? `コメント: ${comment}\n` : ''}詳細: ${detailUrl}`,
    html,
    senderName: '10X RFQ',
  })
}
