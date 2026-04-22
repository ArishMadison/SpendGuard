import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const META_API_VERSION = 'v19.0'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()

    // ── Mode 1: Direct token (System User or any known token) ──────────────
    // POST { direct_token: "EAAxxxx" }
    // Skips OAuth exchange entirely — just fetches ad accounts with the token.
    if (body.direct_token) {
      return await fetchAdAccounts(body.direct_token)
    }

    // ── Mode 2: OAuth code exchange ────────────────────────────────────────
    // POST { code: "...", redirect_uri: "..." }
    const { code, redirect_uri } = body
    if (!code || !redirect_uri) {
      return json({ error: 'Provide either direct_token or {code, redirect_uri}' }, 400)
    }

    const appId     = Deno.env.get('META_APP_ID')!
    const appSecret = Deno.env.get('META_APP_SECRET')!

    // Step 1: Exchange authorization code for short-lived token
    const tokenUrl =
      `https://graph.facebook.com/oauth/access_token` +
      `?client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&code=${code}`

    const tokenRes  = await fetch(tokenUrl)
    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      console.error('[meta-oauth-exchange] token exchange failed:', tokenData)
      return json({ error: tokenData.error?.message || 'Token exchange failed' }, 400)
    }

    // Step 2: Extend to long-lived token (~60 days)
    const extendUrl =
      `https://graph.facebook.com/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`

    const extendRes  = await fetch(extendUrl)
    const extendData = await extendRes.json()
    const accessToken = extendData.access_token || tokenData.access_token

    return await fetchAdAccounts(accessToken)

  } catch (err) {
    console.error('[meta-oauth-exchange]', err)
    return json({ error: err.message }, 500)
  }
})

// Fetch all ad accounts accessible by a token (handles pagination)
async function fetchAdAccounts(accessToken: string) {
  const allAccounts: Record<string, string>[] = []
  let url: string | null =
    `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts` +
    `?fields=id,name,account_status,currency` +
    `&access_token=${accessToken}` +
    `&limit=100`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json()

    if (!data.data) {
      console.error('[meta-oauth-exchange] adaccounts fetch failed:', data)
      return json({ error: data.error?.message || 'Failed to fetch ad accounts' }, 400)
    }

    allAccounts.push(...data.data)
    url = data.paging?.next || null
  }

  const adAccounts = allAccounts.map((a) => ({
    id:       a.id,
    name:     a.name,
    currency: a.currency,
    active:   String(a.account_status) === '1',
  }))

  return json({ access_token: accessToken, ad_accounts: adAccounts })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
