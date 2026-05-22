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
      .select('id, status, title, total, tax_amount, created_by, requested_approver_id, customer_name, customers(name)')
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

    // 申請者・承認者のプロフィール取得
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('name, chat_webhook_url')
      .eq('id', (q as any).created_by)
      .single()

    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', (q as any).requested_approver_id)
      .single()

    const approverName = (approverProfile as any)?.name || '承認者'
    const requesterName = (requesterProfile as any)?.name || '担当者'
    const customerName = (q as any).customers?.name || (q as any).customer_name || '―'
    const taxExcl = Number((q as any).total || 0) - Number((q as any).tax_amount || 0)
    const isApprove = action === 'approve'
    const appUrl = Deno.env.get('APP_URL') || ''

    const webhookUrl = (requesterProfile as any)?.chat_webhook_url || Deno.env.get('GOOGLE_CHAT_WEBHOOK_URL')
    if (webhookUrl) {
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
            header: { title: `${statusLabel} 見積の処理結果`, subtitle: statusMsg },
            sections,
          },
        }],
      }

      try {
        const chatRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        })
        if (!chatRes.ok) {
          console.error('Google Chat webhook error:', await chatRes.text())
        }
      } catch (e) {
        console.error('Chat send failed:', e)
      }
    } else {
      console.error('No webhook URL for requester:', (q as any).created_by)
    }

    return new Response(JSON.stringify({ success: true, quotation_id: (q as any).id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('process-approval error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
