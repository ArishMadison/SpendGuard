import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jwtVerify } from 'https://esm.sh/jose@5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { token, password } = await req.json()
    if (!token || !password) return json({ error: 'token and password required' }, 400)
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400)

    // Verify JWT using jose
    const secret = new TextEncoder().encode(Deno.env.get('JWT_INVITE_SECRET')!)

    let payload: { workspace_id: number; email: string; purpose: string }
    try {
      const result = await jwtVerify(token, secret)
      payload = result.payload as typeof payload
    } catch {
      return json({ error: 'Invalid or expired invite link' }, 400)
    }

    if (payload.purpose !== 'invite') return json({ error: 'Invalid token purpose' }, 400)

    // Check invitations table
    const { data: invite, error: inviteErr } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single()

    if (inviteErr || !invite) return json({ error: 'Invite not found' }, 404)
    if (invite.revoked)      return json({ error: 'This invite has been revoked' }, 400)
    if (invite.accepted_at)  return json({ error: 'This invite has already been accepted' }, 400)

    // Create Supabase Auth user
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email:         payload.email,
      password,
      email_confirm: true,
    })
    if (createErr) throw createErr

    const newUserId = created.user.id

    // Insert user_profiles row
    const { error: profileErr } = await supabase.from('user_profiles').insert({
      id:           newUserId,
      role:         'workspace_user',
      workspace_id: payload.workspace_id,
    })
    if (profileErr) throw profileErr

    // Link user to workspace
    const { error: wsErr } = await supabase
      .from('workspaces')
      .update({ user_id: newUserId })
      .eq('id', payload.workspace_id)
    if (wsErr) throw wsErr

    // Mark invitation accepted
    const { error: acceptErr } = await supabase
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token)
    if (acceptErr) throw acceptErr

    // Sign in and return session
    const { data: sessionData, error: signInErr } = await supabase.auth.signInWithPassword({
      email:    payload.email,
      password,
    })
    if (signInErr) throw signInErr

    return json({ success: true, session: sessionData.session })
  } catch (err) {
    console.error('[accept-invite]', err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
