import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const { workspace_id, ad_account_id, account_name, access_token } = await req.json()
    if (!workspace_id || !ad_account_id || !access_token) {
      return json({ error: 'workspace_id, ad_account_id and access_token required' }, 400)
    }

    // Insert the ad account row
    const { error: insertErr } = await supabase
      .from('workspace_ad_accounts')
      .insert({
        workspace_id,
        ad_account_id,
        account_name: account_name || null,
        access_token, // stored directly for now; Vault encryption can be added later
        is_active: true,
      })

    if (insertErr) throw insertErr

    // Trigger immediate entity cache sync for this account
    const syncRes = await supabase.functions.invoke('refresh-entity-cache', {
      body: { ad_account_id, workspace_id },
    })

    const synced = syncRes.data?.synced ?? 0
    if (syncRes.error) {
      console.warn('[link-ad-account] entity sync warning:', syncRes.error.message)
    }

    return json({ success: true, synced })
  } catch (err) {
    console.error('[link-ad-account]', err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
