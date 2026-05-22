import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function fmt(n: number) {
  return Number(n).toLocaleString('ja-JP')
}

function fmtRate(rate: number, manual: boolean, effectiveRate?: number): string {
  if (manual) {
    const eff = effectiveRate !== undefined ? effectiveRate.toFixed(1) : rate.toFixed(1)
    return `手入力 (実: ${eff}%)`
  }
  return `${Number(rate).toFixed(1)}%`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { quotation_id, screenshot_base64 } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

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

    // 承認者プロフィール取得
    const { data: approverProfile } = await supabase
      .from('profiles')
      .select('name, chat_webhook_url')
      .eq('id', q.requested_approver_id)
      .single()

    // 明細取得（仕入・率計算用）
    const { data: allItems } = await supabase
      .from('quotation_items')
      .select('name, spec, category, amount, purchase_quantity, purchase_unit_price')
      .eq('quotation_id', quotation_id)

    const purchaseTotal = (allItems || []).reduce((s: number, i: any) =>
      s + Number(i.purchase_quantity || 0) * Number(i.purchase_unit_price || 0), 0)

    // 明細を種別に分類
    const miscItem = (allItems || []).find((i: any) =>
      i.name === '雑材消耗品' && i.category === '材料費' && !i.spec?.startsWith('__managed__:') && i.spec !== '__subcategory__')
    const managedItems = (allItems || []).filter((i: any) => i.spec?.startsWith('__managed__:'))
    const normalItems = (allItems || []).filter((i: any) =>
      !i.spec?.startsWith('__managed__:') && i.spec !== '__subcategory__' &&
      !(i.name === '雑材消耗品' && i.category === '材料費'))

    // 雑材消耗品の率・手入力判定
    const zaizaiRate = miscItem ? (Number(miscItem.spec) || 10) : 10
    const zaizaiBase = normalItems
      .filter((i: any) => i.category === '材料費')
      .reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
    const zaizaiAuto = Math.round(zaizaiBase * zaizaiRate / 100)
    const zaizaiActual = Number(miscItem?.amount || 0)
    const zaizaiManual = miscItem != null && Math.abs(zaizaiActual - zaizaiAuto) > 1
    const zaizaiEffRate = zaizaiBase > 0 ? Math.round(zaizaiActual / zaizaiBase * 1000) / 10 : 0

    // カテゴリ小計（雑材含む）
    function getCatSub(cat: string): number {
      const s = normalItems
        .filter((i: any) => i.category === cat)
        .reduce((a: number, i: any) => a + Number(i.amount || 0), 0)
      if (cat === '材料費' && miscItem) return s + zaizaiActual
      return s
    }

    // 全体小計（値引き率計算用）
    const subtotal = (allItems || []).reduce((s: number, i: any) => {
      if (i.spec === '__subcategory__') return s
      if (i.name === '雑材消耗品' && i.category === '材料費') return s + zaizaiActual
      return s + Number(i.amount || 0)
    }, 0)

    // 労務費計（法定福利費率計算用）
    const laborBase = getCatSub('労務費')

    // 法定福利費
    const welfareManual = q.welfare_manual ?? false
    const welfareRate = Number(q.welfare_rate || 0)
    const welfareActual = Number(q.welfare_cost || 0)
    const welfareEffRate = laborBase > 0 ? Math.round(welfareActual / laborBase * 1000) / 10 : 0

    // 値引き
    const discountManual = q.discount_manual ?? false
    const discountRate = Number(q.discount_rate || 0)
    const discountActual = Number(q.discount || 0)
    const discountEffRate = subtotal > 0 ? Math.round(discountActual / subtotal * 1000) / 10 : 0

    // ワンタイムトークン生成
    const approveToken = crypto.randomUUID()
    const rejectToken = crypto.randomUUID()

    await supabase.from('quotations').update({
      approve_token: approveToken,
      reject_token: rejectToken,
    }).eq('id', quotation_id)

    // スクリーンショットをStorageにアップロード
    let screenshotUrl = ''
    if (screenshot_base64) {
      try {
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
      } catch (e) {
        console.error('Screenshot upload failed:', e)
      }
    }

    const appUrl = Deno.env.get('APP_URL') || ''
    const approveUrl = `${appUrl}/approval-action?token=${approveToken}&action=approve`
    const rejectUrl = `${appUrl}/approval-action?token=${rejectToken}&action=reject`

    const customerName = q.customers?.name || q.customer_name || '―'
    const requesterName = (q as any).profiles?.name || '担当者'
    const approverName = (approverProfile as any)?.name || '承認者'
    const taxExcl = Number(q.total || 0) - Number(q.tax_amount || 0)
    const profit = taxExcl - purchaseTotal
    const profitRate = taxExcl > 0 ? Math.round(profit / taxExcl * 100 * 10) / 10 : 0
    const profitSign = profit >= 0 ? '+' : ''

    // 承認者個人のWebhook URL → なければ共通のWebhook URL
    const webhookUrl = (approverProfile as any)?.chat_webhook_url || Deno.env.get('GOOGLE_CHAT_WEBHOOK_URL')
    if (!webhookUrl) {
      return new Response(JSON.stringify({ error: 'No webhook URL configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 基本情報ウィジェット
    const infoWidgets: any[] = [
      { decoratedText: { topLabel: '取引先', text: `<b>${customerName}</b>` } },
      { decoratedText: { topLabel: '案件名', text: q.title || '―' } },
      { decoratedText: { topLabel: '見積金額（税抜）', text: `<b>¥${fmt(taxExcl)}</b>` } },
      { decoratedText: { topLabel: '仕入 / 利益 / 利益率', text: `¥${fmt(purchaseTotal)} / ¥${fmt(profit)} / ${profitSign}${profitRate.toFixed(1)}%` } },
    ]

    // 費用率ウィジェット
    const rateWidgets: any[] = []

    if (miscItem) {
      rateWidgets.push({
        decoratedText: {
          topLabel: '雑材消耗品',
          text: fmtRate(zaizaiRate, zaizaiManual, zaizaiEffRate),
        }
      })
    }

    for (const item of managedItems) {
      const parts = (item.spec || '').split(':')
      const mRate = Number(parts[1]) || 0
      const baseCatStr = parts.slice(2).join(':')
      const baseCats: string[] = baseCatStr ? baseCatStr.split(',') : ['材料費', '労務費']
      const baseSum = baseCats.reduce((s: number, cat: string) => s + getCatSub(cat), 0)
      const autoAmt = Math.round(baseSum * mRate / 100)
      const actualAmt = Number(item.amount || 0)
      const isManual = Math.abs(actualAmt - autoAmt) > 1
      const effRate = baseSum > 0 ? Math.round(actualAmt / baseSum * 1000) / 10 : 0
      rateWidgets.push({
        decoratedText: {
          topLabel: item.name,
          text: fmtRate(mRate, isManual, effRate),
        }
      })
    }

    if (welfareActual !== 0 || welfareRate !== 0) {
      rateWidgets.push({
        decoratedText: {
          topLabel: '法定福利費',
          text: fmtRate(welfareRate, welfareManual, welfareEffRate),
        }
      })
    }

    if (discountActual !== 0 || discountRate !== 0) {
      rateWidgets.push({
        decoratedText: {
          topLabel: '御値引き',
          text: fmtRate(discountRate, discountManual, discountEffRate),
        }
      })
    }

    const sections: any[] = [
      { widgets: infoWidgets },
    ]

    if (rateWidgets.length > 0) {
      sections.push({
        header: '費用内訳（率）',
        widgets: rateWidgets,
      })
    }

    if (screenshotUrl) {
      sections.push({
        widgets: [{
          image: {
            imageUrl: screenshotUrl,
            altText: '見積プレビュー',
            onClick: { openLink: { url: `${appUrl}/quotations/${q.id}/print` } },
          },
        }],
      })
    }

    sections.push({
      widgets: [{
        buttonList: {
          buttons: [
            {
              text: '✅ 承認する',
              onClick: { openLink: { url: approveUrl } },
              color: { red: 0.09, green: 0.64, blue: 0.24, alpha: 1 },
            },
            {
              text: '↩ 差し戻す',
              onClick: { openLink: { url: rejectUrl } },
              color: { red: 0.86, green: 0.15, blue: 0.15, alpha: 1 },
            },
          ],
        },
      }],
    })

    const message = {
      cardsV2: [{
        cardId: 'approvalCard',
        card: {
          header: {
            title: '📋 見積承認依頼',
            subtitle: `${q.companies?.name || ''} | ${requesterName} → ${approverName}`,
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
      return new Response(JSON.stringify({ error: 'Chat notification failed', detail: errText }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('send-approval-email error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
