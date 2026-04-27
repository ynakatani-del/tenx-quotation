import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const action = url.searchParams.get('action')
  const appUrl = Deno.env.get('APP_URL') || ''

  function redirect(path: string) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `${appUrl}${path}` },
    })
  }

  if (!token || !['approve', 'reject'].includes(action || '')) {
    return redirect('/approval-result?action=error')
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const tokenCol = action === 'approve' ? 'approve_token' : 'reject_token'
  const { data: q } = await supabase
    .from('quotations')
    .select('id, status')
    .eq(tokenCol, token)
    .single()

  if (!q) {
    return redirect('/approval-result?action=error')
  }

  const status = (q as any).status
  if (status === 'approved') {
    return redirect('/approval-result?action=already_approved')
  }
  if (status === 'rejected') {
    return redirect('/approval-result?action=already_rejected')
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected'
  await supabase.from('quotations').update({
    status: newStatus,
    approve_token: null,
    reject_token: null,
  }).eq('id', (q as any).id)

  return redirect(`/approval-result?action=${action}`)
})
