import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const META_API_VERSION = 'v19.0'
const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}/`

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

    const { ad_account_id, workspace_id } = await req.json()
    if (!ad_account_id || !workspace_id) {
      return json({ error: 'ad_account_id and workspace_id required' }, 400)
    }

    // Get access token for this ad account
    const { data: accountRow, error: accountErr } = await supabase
      .from('workspace_ad_accounts')
      .select('access_token')
      .eq('ad_account_id', ad_account_id)
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
      .single()

    if (accountErr || !accountRow) return json({ error: 'Ad account not found' }, 404)

    const accessToken = accountRow.access_token
    const entities: object[] = []
    const now = new Date().toISOString()

    // Fetch campaigns
    const campaigns = await fetchAll(`${ad_account_id}/campaigns`, 'id,name,status,effective_status,objective,daily_budget', accessToken)
    for (const c of campaigns) {
      entities.push({ entity_id: c.id, entity_type: 'campaign', parent_id: null, ad_account_id, workspace_id, name: c.name, status: c.status, daily_budget: c.daily_budget ? parseFloat(c.daily_budget) : null, objective: c.objective || null, last_synced_at: now })
    }

    // Fetch adsets
    const adsets = await fetchAll(`${ad_account_id}/adsets`, 'id,name,status,effective_status,campaign_id,daily_budget', accessToken)
    for (const a of adsets) {
      entities.push({ entity_id: a.id, entity_type: 'adset', parent_id: a.campaign_id, ad_account_id, workspace_id, name: a.name, status: a.status, daily_budget: a.daily_budget ? parseFloat(a.daily_budget) : null, objective: null, last_synced_at: now })
    }

    // Fetch ads
    const ads = await fetchAll(`${ad_account_id}/ads`, 'id,name,status,effective_status,adset_id', accessToken)
    for (const a of ads) {
      entities.push({ entity_id: a.id, entity_type: 'ad', parent_id: a.adset_id, ad_account_id, workspace_id, name: a.name, status: a.status, daily_budget: null, objective: null, last_synced_at: now })
    }

    if (entities.length > 0) {
      const { error: upsertErr } = await supabase
        .from('entity_cache')
        .upsert(entities, { onConflict: 'entity_id' })
      if (upsertErr) throw upsertErr
    }

    return json({ success: true, synced: entities.length })
  } catch (err) {
    console.error('[refresh-entity-cache]', err)
    return json({ error: err.message }, 500)
  }
})

async function fetchAll(edge: string, fields: string, accessToken: string): Promise<Record<string, string>[]> {
  const results: Record<string, string>[] = []
  let url: string | null = `${META_GRAPH_URL}${edge}?fields=${fields}&access_token=${accessToken}&limit=200`

  while (url) {
    const res = await fetch(url)
    const data = await res.json()
    if (data.data) results.push(...data.data)
    url = data.paging?.next || null
  }

  return results
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
