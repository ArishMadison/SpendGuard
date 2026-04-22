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

    const { entity_id } = await req.json()
    if (!entity_id) return json({ error: 'entity_id required' }, 400)

    const { data, error } = await supabase
      .from('entity_cache')
      .select(`
        entity_id, entity_type, name, status,
        budget_source, budget_type, campaign_budget_opt,
        daily_budget, lifetime_budget, last_synced_at
      `)
      .eq('entity_id', entity_id)
      .maybeSingle()

    if (error) throw error

    if (!data) return json({ exists: false })

    return json({ exists: true, entity: data })
  } catch (err) {
    console.error('[validate-entity]', err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
