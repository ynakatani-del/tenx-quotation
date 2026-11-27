import { createClient } from 'npm:@supabase/supabase-js@2'
import { isCompanyEmail } from '../_shared/company-email.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
}
const allowedRoles = new Set(['general', 'admin', 'maintenance_admin', 'super_admin'])
const auth = { persistSession: false, autoRefreshToken: false }

const fail = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return fail('Method not allowed', 405)
  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return fail('Unauthorized', 401)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth })
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return fail('Unauthorized', 401)
    if (!isCompanyEmail(user.email) || (user.banned_until && Date.parse(user.banned_until) > Date.now())) {
      return fail('Forbidden', 403)
    }

    const kind = (await req.json().catch(() => null))?.kind
    if (kind !== 'guide' && kind !== 'handover') return fail('Invalid document', 400)

    const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth })
    const { data: profile, error: profileError } = await server.from('profiles')
      .select('status, role, quotation_suspended').eq('id', user.id).maybeSingle()
    if (profileError) return fail('Unavailable', 503)
    if (profile?.status !== 'active' || profile.quotation_suspended !== false
      || !allowedRoles.has(profile.role) || (kind === 'handover' && profile.role !== 'super_admin')) {
      return fail('Forbidden', 403)
    }

    // Use server-only object paths; never return a signed URL to the browser.
    const file = kind === 'guide' ? 'documents/guide.json' : 'documents/handover.json'
    const { data, error } = await server.storage.from('quotation-handover')
      .download(file, {}, { cache: 'no-store' })
    if (error || !data) return fail('Unavailable', 503)
    return new Response(data, { headers })
  } catch {
    return fail('Unavailable', 503)
  }
})
