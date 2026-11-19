import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendQuotationResultEmail } from '../_shared/quotation-result-email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, action, comment } = await req.json()
    if (!token || !['approve', 'reject'].includes(action)) return respond({ error: 'invalid' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const tokenColumn = action === 'approve' ? 'approve_token' : 'reject_token'
    const { data: quotation } = await supabase
      .from('quotations')
      .select('id, status, requested_approver_id')
      .eq(tokenColumn, token)
      .single()

    if (!quotation) return respond({ error: 'not_found' })
    if (quotation.status === 'approved') return respond({ error: 'already_approved' })
    if (quotation.status === 'rejected') return respond({ error: 'already_rejected' })

    const isApproved = action === 'approve'
    const update = {
      status: isApproved ? 'approved' : 'rejected',
      approve_token: null,
      reject_token: null,
      ...(isApproved ? {
        approved_by: quotation.requested_approver_id,
        approved_at: new Date().toISOString(),
      } : {
        rejection_reason: comment || null,
      }),
    }
    const { error: updateError } = await supabase
      .from('quotations')
      .update(update)
      .eq('id', quotation.id)
    if (updateError) throw updateError

    let notificationFailed = false
    try {
      await sendQuotationResultEmail(
        supabase,
        quotation.id,
        action,
        comment,
        quotation.requested_approver_id,
      )
    } catch (notificationError) {
      notificationFailed = true
      console.error('result email notification failed:', notificationError)
    }

    return respond({ success: true, quotation_id: quotation.id, notification_failed: notificationFailed })
  } catch (error) {
    console.error('process-approval error:', error)
    return respond({ error: String(error) }, 500)
  }
})
