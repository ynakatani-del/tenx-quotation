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
    const { quotation_id, action, comment, approver_id } = await req.json()
    if (!quotation_id || !['approve', 'reject'].includes(action)) {
      return respond({ error: 'invalid' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await sendQuotationResultEmail(supabase, quotation_id, action, comment, approver_id)
    return respond({ success: true })
  } catch (error) {
    console.error('notify-requester error:', error)
    return respond({ error: String(error) }, 500)
  }
})
