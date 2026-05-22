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
    const { quotation_id, action, comment, approver_id } = await req.json()

    if (!quotation_id || !['approve', 'reject'].includes(action)) {
      return new Response(JSON.stringify({ error: 'invalid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: q } = await supabase
      .from('quotations')
      .select('id, title, total, tax_amount, created_by, customer_name, customers(name)')
      .eq('id', quotation_id)
      .single()

    if (!q) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 依頼者プロフィール（chat_webhook_url含む）を取得
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('name, chat_webhook_url')
      .eq('id', (q as any).created_by)
      .single()

    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', approver_id)
      .single()

    const approverName = (approverProfile as any)?.name || '承認者'
    const requesterName = (requesterProfile as any)?.name || '担当者'
    const customerName = (q as any).customers?.name || (q as any).customer_name || '―'
    const taxExcl = Number((q as any).total || 0) - Number((q as any).tax_amount || 0)
    const isApprove = action === 'approve'
    const appUrl = Deno.env.get('APP_URL') || ''

    // 依頼者個人のWebhook URL → なければ共通のWebhook URL
    const webhookUrl = (requesterProfile as any)?.chat_webhook_url || Deno.env.get('GOOGLE_CHAT_WEBHOOK_URL')
    if (!webhookUrl) {
      return new Response(JSON.stringify({ error: 'No webhook URL configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const statusLabel = isApprove ? '✅ 承認済み' : '↩ 差し戻し'
    const statusMsg = isApprove
      ? `${approverName}さんが承認しました。`
      : `${approverName}さんが差し戻しました。`

    const widgets: any[] = [
      { decoratedText: { topLabel: '担当者', text: requesterName } },
      { decoratedText: { topLabel: '取引先', text: `<b>${customerName}</b>` } },
      { decoratedText: { topLabel: '案件名', text: (q as any).title || '―' } },
      { decoratedText: { topLabel: '見積金額（税抜）', text: `<b>¥${fmt(taxExcl)}</b>` } },
    ]

    if (comment) {
      widgets.push({ decoratedText: { topLabel: 'コメント', text: comment } })
    }

    const sections: any[] = [{ widgets }]

    if (appUrl) {
      sections.push({
        widgets: [{
          buttonList: {
            buttons: [{
              text: '見積書を確認する',
              onClick: { openLink: { url: `${appUrl}/quotations/${(q as any).id}/edit` } },
            }],
          },
        }],
      })
    }

    const message = {
      cardsV2: [{
        cardId: 'notifyCard',
        card: {
          header: {
            title: `${statusLabel} 見積の処理結果`,
            subtitle: statusMsg,
          },
          sections,
        },
      }],
    }

    const chatRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!chatRes.ok) {
      const errText = await chatRes.text()
      console.error('Google Chat webhook error:', errText)
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('notify-requester error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
