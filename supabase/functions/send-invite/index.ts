import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT } from 'https://esm.sh/jose@5'

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

    // Only super_admin can call this
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)

    const { workspace_id, email } = await req.json()
    if (!workspace_id || !email) return json({ error: 'workspace_id and email required' }, 400)

    // Generate signed JWT invite token using jose
    const secret = new TextEncoder().encode(Deno.env.get('JWT_INVITE_SECRET')!)
    const token = await new SignJWT({ workspace_id, email, purpose: 'invite' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .setIssuedAt()
      .sign(secret)

    // Insert invitation row
    const { error: insertErr } = await supabase.from('invitations').insert({
      workspace_id,
      email,
      token,
    })
    if (insertErr) throw insertErr

    // Send invite email via SendGrid
    const frontendUrl = Deno.env.get('FRONTEND_URL')!
    const inviteLink  = `${frontendUrl}/accept-invite?token=${token}`

    const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SENDGRID_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: Deno.env.get('EMAIL_FROM') },
        subject: 'You have been invited to SpendGuard',
        content: [{
          type: 'text/html',
          value: `
            <p>You've been invited to manage ad campaign alerts in SpendGuard.</p>
            <p><a href="${inviteLink}" style="padding:10px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:4px;">Accept invitation</a></p>
            <p style="color:#6b7280;font-size:13px;">This link expires in 24 hours.</p>
          `,
        }],
      }),
    })

    if (!sgResponse.ok) {
      const errBody = await sgResponse.text()
      throw new Error(`SendGrid error: ${errBody}`)
    }

    return json({ success: true })
  } catch (err) {
    console.error('[send-invite]', err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
