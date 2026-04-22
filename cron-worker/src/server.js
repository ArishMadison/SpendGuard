'use strict'

require('dotenv').config()
const express    = require('express')
const cors       = require('cors')
const { createClient } = require('@supabase/supabase-js')
const { SignJWT, jwtVerify } = require('jose')
const config     = require('./config')

const app = express()
app.use(cors())
app.use(express.json())

// ── Supabase admin client (service role, bypasses RLS) ────────────────────────
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey)

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res, body, status = 200) {
  return res.status(status).json(body)
}

// Verify the Supabase JWT from Authorization header and return the user
async function getAuthUser(req) {
  const authHeader = req.headers['authorization']
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}

// Check if user is super_admin
async function isSuperAdmin(userId) {
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return data?.role === 'super_admin'
}

const jwtSecret = new TextEncoder().encode(config.jwtInviteSecret)

// ── POST /send-invite ─────────────────────────────────────────────────────────
// Super admin only. Generates invite token, inserts invitation row, sends email.
app.post('/send-invite', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)
    if (!await isSuperAdmin(user.id)) return json(res, { error: 'Forbidden' }, 403)

    const { workspace_id, email } = req.body
    if (!workspace_id || !email) return json(res, { error: 'workspace_id and email required' }, 400)

    // Block invite if no ad accounts are linked yet
    const { count: aaCount, error: aaErr } = await supabase
      .from('workspace_ad_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)
    if (aaErr) throw aaErr
    if (!aaCount || aaCount === 0) {
      return json(res, { error: 'No ad accounts are linked to this workspace yet. Link at least one ad account before sending an invite.' }, 400)
    }

    // Generate signed JWT invite token
    const token = await new SignJWT({ workspace_id, email, purpose: 'invite' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .setIssuedAt()
      .sign(jwtSecret)

    // Insert invitation row
    const { error: insertErr } = await supabase.from('invitations').insert({
      workspace_id,
      email,
      token,
    })
    if (insertErr) throw insertErr

    // Send invite email via SendGrid
    const inviteLink = `${config.frontendUrl}/accept-invite?token=${token}`

    const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: config.emailFrom },
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

    return json(res, { success: true })
  } catch (err) {
    console.error('[send-invite]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /accept-invite ───────────────────────────────────────────────────────
// Public. Verifies invite token, creates Supabase Auth user, links workspace.
app.post('/accept-invite', async (req, res) => {
  try {
    const { token, password } = req.body
    if (!token || !password) return json(res, { error: 'token and password required' }, 400)
    if (password.length < 8) return json(res, { error: 'Password must be at least 8 characters' }, 400)

    // Verify JWT
    let payload
    try {
      const result = await jwtVerify(token, jwtSecret)
      payload = result.payload
    } catch {
      return json(res, { error: 'Invalid or expired invite link' }, 400)
    }

    if (payload.purpose !== 'invite') return json(res, { error: 'Invalid token purpose' }, 400)

    // Check invitations table
    const { data: invite, error: inviteErr } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .single()

    if (inviteErr || !invite) return json(res, { error: 'Invite not found' }, 404)
    if (invite.revoked)     return json(res, { error: 'This invite has been revoked' }, 400)
    if (invite.accepted_at) return json(res, { error: 'This invite has already been accepted' }, 400)

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

    // Link user to workspace; if no notification_email set yet, default to the invited email
    const { data: existingWs } = await supabase
      .from('workspaces')
      .select('notification_email')
      .eq('id', payload.workspace_id)
      .single()

    const wsUpdate = { user_id: newUserId }
    if (!existingWs?.notification_email) {
      wsUpdate.notification_email = payload.email
    }

    const { error: wsErr } = await supabase
      .from('workspaces')
      .update(wsUpdate)
      .eq('id', payload.workspace_id)
    if (wsErr) throw wsErr

    // Mark invitation accepted
    const { error: acceptErr } = await supabase
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token)
    if (acceptErr) throw acceptErr

    // Trigger entity cache sync for all ad accounts linked to this workspace.
    // Runs in background — does not block the invite response.
    // Uses access_token stored in workspace_ad_accounts (set from SYSTEM_USER_TOKEN at link time).
    setImmediate(async () => {
      try {
        const { data: adAccounts } = await supabase
          .from('workspace_ad_accounts')
          .select('ad_account_id, access_token')
          .eq('workspace_id', payload.workspace_id)
          .eq('is_active', true)

        if (!adAccounts || adAccounts.length === 0) {
          console.log('[accept-invite] No ad accounts linked yet — skipping entity sync')
          return
        }

        const { syncEntityCache } = require('./meta/entitySync')
        const systemToken = config.systemUserToken

        for (const acc of adAccounts) {
          const token = acc.access_token || systemToken
          if (!token) {
            console.warn('[accept-invite] No token available for', acc.ad_account_id, '— skipping')
            continue
          }
          await syncEntityCache(acc.ad_account_id, token, payload.workspace_id)
            .catch(err =>
              console.warn('[accept-invite] sync failed for', acc.ad_account_id, ':', err.message)
            )
        }
        console.log(`[accept-invite] Entity sync complete for workspace ${payload.workspace_id} (${adAccounts.length} accounts)`)
      } catch (err) {
        console.warn('[accept-invite] Background entity sync error:', err.message)
      }
    })

    // Sign in and return session
    const { data: sessionData, error: signInErr } = await supabase.auth.signInWithPassword({
      email:    payload.email,
      password,
    })
    if (signInErr) throw signInErr

    return json(res, { success: true, session: sessionData.session })
  } catch (err) {
    console.error('[accept-invite]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /validate-entity ──────────────────────────────────────────────────────
// Authenticated. Checks entity_id exists in entity_cache for this workspace.
app.get('/validate-entity', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)

    const { entity_id, workspace_id } = req.query
    if (!entity_id || !workspace_id) return json(res, { error: 'entity_id and workspace_id required' }, 400)

    const { data, error } = await supabase
      .from('entity_cache')
      .select('entity_id, entity_type, name, status, ad_account_id')
      .eq('entity_id', entity_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (error || !data) return json(res, { valid: false, error: 'Entity not found in cache' }, 404)

    return json(res, { valid: true, entity: data })
  } catch (err) {
    console.error('[validate-entity]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /refresh-entity-cache ────────────────────────────────────────────────
// Authenticated. Triggers entity cache refresh for one ad account.
app.post('/refresh-entity-cache', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)

    const { workspace_id, ad_account_id } = req.body
    if (!workspace_id || !ad_account_id) return json(res, { error: 'workspace_id and ad_account_id required' }, 400)

    // Get the access token for this account
    const { data: waa, error: waaErr } = await supabase
      .from('workspace_ad_accounts')
      .select('access_token')
      .eq('workspace_id', workspace_id)
      .eq('ad_account_id', ad_account_id)
      .single()

    if (waaErr || !waa) return json(res, { error: 'Ad account not found' }, 404)

    // Run the entity sync inline
    const { syncEntityCache } = require('./meta/entitySync')
    await syncEntityCache(ad_account_id, waa.access_token, workspace_id)

    return json(res, { success: true })
  } catch (err) {
    console.error('[refresh-entity-cache]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /ad-accounts ──────────────────────────────────────────────────────────
// Super admin only. Fetches all accessible ad accounts using the server-side
// System User token — the token is NEVER sent to or from the frontend.
app.get('/ad-accounts', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)
    if (!await isSuperAdmin(user.id)) return json(res, { error: 'Forbidden' }, 403)

    const token = config.systemUserToken
    if (!token) {
      return json(res, { error: 'SYSTEM_USER_TOKEN is not configured on the server. Add it to the backend .env file.' }, 500)
    }

    const result = await fetchAdAccounts(token, 'v19.0')
    if (result.error) return json(res, { error: result.error }, 400)

    return json(res, { ad_accounts: result.ad_accounts })
  } catch (err) {
    console.error('[ad-accounts]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /meta-oauth-exchange ─────────────────────────────────────────────────
// Kept for backward compatibility. Prefer GET /ad-accounts for new usage.
app.post('/meta-oauth-exchange', async (req, res) => {
  try {
    const body = req.body
    const META_API_VERSION = 'v19.0'

    // Mode 1: Direct token
    if (body.direct_token) {
      return res.json(await fetchAdAccounts(body.direct_token, META_API_VERSION))
    }

    // Mode 2: OAuth code exchange
    const { code, redirect_uri } = body
    if (!code || !redirect_uri) {
      return json(res, { error: 'Provide either direct_token or {code, redirect_uri}' }, 400)
    }

    const appId     = process.env.META_APP_ID
    const appSecret = process.env.META_APP_SECRET

    // Exchange code for short-lived token
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
      return json(res, { error: tokenData.error?.message || 'Token exchange failed' }, 400)
    }

    // Extend to long-lived token (~60 days)
    const extendUrl =
      `https://graph.facebook.com/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`

    const extendRes  = await fetch(extendUrl)
    const extendData = await extendRes.json()
    const accessToken = extendData.access_token || tokenData.access_token

    return res.json(await fetchAdAccounts(accessToken, META_API_VERSION))
  } catch (err) {
    console.error('[meta-oauth-exchange]', err)
    return json(res, { error: err.message }, 500)
  }
})

async function fetchAdAccounts(accessToken, apiVersion) {
  const allAccounts = []
  let url =
    `https://graph.facebook.com/${apiVersion}/me/adaccounts` +
    `?fields=id,name,account_status,currency` +
    `&access_token=${accessToken}` +
    `&limit=100`

  while (url) {
    const res  = await fetch(url)
    const data = await res.json()
    if (!data.data) {
      return { error: data.error?.message || 'Failed to fetch ad accounts' }
    }
    allAccounts.push(...data.data)
    url = data.paging?.next || null
  }

  return {
    access_token: accessToken,
    ad_accounts: allAccounts.map(a => ({
      id:       a.id,
      name:     a.name,
      currency: a.currency,
      active:   String(a.account_status) === '1',
    })),
  }
}

// ── POST /link-ad-account ─────────────────────────────────────────────────────
// Super admin only. Inserts workspace_ad_accounts row, triggers entity sync.
app.post('/link-ad-account', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)
    if (!await isSuperAdmin(user.id)) return json(res, { error: 'Forbidden' }, 403)

    const { workspace_id, ad_account_id, account_name } = req.body
    if (!workspace_id || !ad_account_id) {
      return json(res, { error: 'workspace_id and ad_account_id required' }, 400)
    }

    // Token always comes from the server env — never from the client
    const access_token = config.systemUserToken
    if (!access_token) {
      return json(res, { error: 'SYSTEM_USER_TOKEN is not configured on the server.' }, 500)
    }

    // Enforce 10 ad account limit per workspace
    const { count, error: countErr } = await supabase
      .from('workspace_ad_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('is_active', true)

    if (countErr) throw countErr
    if (count >= 10) {
      return json(res, { error: 'This workspace has reached the 10 ad account limit. Remove an existing account before linking a new one.' }, 400)
    }

    // Check if this ad account is already linked to a DIFFERENT workspace
    const { data: crossWs } = await supabase
      .from('workspace_ad_accounts')
      .select('workspace_id, workspaces(name)')
      .eq('ad_account_id', ad_account_id)
      .neq('workspace_id', workspace_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (crossWs) {
      return json(res, {
        error: `This ad account is already linked to workspace "${crossWs.workspaces?.name || crossWs.workspace_id}". An ad account can only belong to one workspace.`
      }, 400)
    }

    // Check if this ad account is already linked to this workspace
    const { data: existing } = await supabase
      .from('workspace_ad_accounts')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('ad_account_id', ad_account_id)
      .maybeSingle()

    if (existing) {
      // Update the existing row (e.g. refresh token or name)
      const { error: updateErr } = await supabase
        .from('workspace_ad_accounts')
        .update({ account_name: account_name || ad_account_id, access_token, is_active: true })
        .eq('id', existing.id)
      if (updateErr) throw updateErr
    } else {
      // Insert new row
      const { error: insertErr } = await supabase
        .from('workspace_ad_accounts')
        .insert({ workspace_id, ad_account_id, account_name: account_name || ad_account_id, access_token, is_active: true })
      if (insertErr) throw insertErr
    }

    // Trigger immediate entity cache sync
    try {
      const { syncEntityCache } = require('./meta/entitySync')
      await syncEntityCache(ad_account_id, access_token, workspace_id)
    } catch (syncErr) {
      console.warn('[link-ad-account] entity sync failed (non-fatal):', syncErr.message)
    }

    return json(res, { success: true })
  } catch (err) {
    console.error('[link-ad-account]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /remove-user ─────────────────────────────────────────────────────────
// Super admin only. Fully removes a workspace user: deletes their auth account,
// clears workspace.user_id, deletes user_profiles row. Workspace + rules preserved.
app.post('/remove-user', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)
    if (!await isSuperAdmin(user.id)) return json(res, { error: 'Forbidden' }, 403)

    const { workspace_id } = req.body
    if (!workspace_id) return json(res, { error: 'workspace_id required' }, 400)

    // Get the current user assigned to this workspace
    const { data: ws, error: wsErr } = await supabase
      .from('workspaces')
      .select('user_id')
      .eq('id', workspace_id)
      .single()
    if (wsErr) throw wsErr
    if (!ws?.user_id) return json(res, { error: 'No user is currently assigned to this workspace' }, 400)

    const userId = ws.user_id

    // Delete Supabase Auth user (service role — can actually do this)
    const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
    if (delErr) throw delErr

    // Clear workspace.user_id
    await supabase.from('workspaces').update({ user_id: null }).eq('id', workspace_id)

    // Delete user_profiles row
    await supabase.from('user_profiles').delete().eq('id', userId)

    return json(res, { success: true })
  } catch (err) {
    console.error('[remove-user]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /run-job — manually trigger the cron evaluation job ─────────────────
app.post('/run-job', async (req, res) => {
  try {
    const user = await getAuthUser(req)
    if (!user) return json(res, { error: 'Unauthorized' }, 401)
    if (!await isSuperAdmin(user.id)) return json(res, { error: 'Forbidden' }, 403)

    const { runJob } = require('./runJob')
    console.log('[run-job] Manual trigger by', user.id)
    const stats = await runJob()
    return json(res, { success: true, stats })
  } catch (err) {
    console.error('[run-job]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// DATA API — all frontend data queries route through these endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: get user profile (role + workspace_id)
async function getUserProfile(userId) {
  const { data } = await supabase
    .from('user_profiles')
    .select('role, workspace_id')
    .eq('id', userId)
    .single()
  return data
}

// Helper: verify auth + workspace access. Returns { user, profile } or sends error.
async function requireAuth(req, res) {
  const user = await getAuthUser(req)
  if (!user) { json(res, { error: 'Unauthorized' }, 401); return null }
  const profile = await getUserProfile(user.id)
  if (!profile) { json(res, { error: 'Profile not found' }, 403); return null }
  return { user, profile }
}

function canAccessWorkspace(profile, wsId) {
  return profile.role === 'super_admin' || profile.workspace_id === parseInt(wsId)
}

// ── GET /me — current user profile ───────────────────────────────────────────
app.get('/me', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    return json(res, { role: auth.profile.role, workspace_id: auth.profile.workspace_id })
  } catch (err) {
    console.error('[me]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces — list workspaces ────────────────────────────────────────
app.get('/workspaces', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    let query = supabase
      .from('workspaces')
      .select('*, workspace_ad_accounts(id, ad_account_id)')
      .order('created_at', { ascending: false })

    if (auth.profile.role !== 'super_admin') {
      query = query.eq('id', auth.profile.workspace_id)
    }

    const { data, error } = await query
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[workspaces]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id — single workspace with ad accounts ──────────────────
app.get('/workspaces/:id', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('workspaces')
      .select('*, workspace_ad_accounts(*)')
      .eq('id', req.params.id)
      .single()
    if (error) throw error
    // Strip access_token from ad accounts before returning
    if (data?.workspace_ad_accounts) {
      data.workspace_ad_accounts = data.workspace_ad_accounts.map(({ access_token, ...rest }) => rest)
    }
    // Include assigned user email (from accepted invitation)
    if (data?.user_id) {
      const { data: invite } = await supabase
        .from('invitations')
        .select('email')
        .eq('workspace_id', req.params.id)
        .not('accepted_at', 'is', null)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      data.assigned_user_email = invite?.email || null
    }
    return json(res, data)
  } catch (err) {
    console.error('[workspaces/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /workspaces — create workspace ──────────────────────────────────────
app.post('/workspaces', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('workspaces')
      .insert(req.body)
      .select()
      .single()
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[create-workspace]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── PATCH /workspaces/:id — update workspace ─────────────────────────────────
app.patch('/workspaces/:id', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('workspaces')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[update-workspace]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id/ad-accounts ──────────────────────────────────────────
app.get('/workspaces/:id/ad-accounts', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('workspace_ad_accounts')
      .select('id, workspace_id, ad_account_id, account_name, is_active, linked_at')
      .eq('workspace_id', req.params.id)
      .order('linked_at', { ascending: false })
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[ad-accounts/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id/rules — rules for a workspace ────────────────────────
app.get('/workspaces/:id/rules', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('validation_rules')
      .select('*')
      .eq('workspace_id', req.params.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[rules/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /all-rules — all rules across workspaces (admin) ─────────────────────
app.get('/all-rules', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('validation_rules')
      .select('*, workspaces(name)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[all-rules]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── POST /rules — create rule ────────────────────────────────────────────────
app.post('/rules', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.body.workspace_id))
      return json(res, { error: 'Forbidden' }, 403)

    const payload = { ...req.body, created_by: auth.user.id, updated_by: auth.user.id }
    const { data, error } = await supabase
      .from('validation_rules')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[create-rule]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── PATCH /rules/:id — update rule ───────────────────────────────────────────
app.patch('/rules/:id', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    // Fetch the rule to check workspace access
    const { data: rule } = await supabase.from('validation_rules').select('workspace_id').eq('id', req.params.id).single()
    if (!rule) return json(res, { error: 'Rule not found' }, 404)
    if (!canAccessWorkspace(auth.profile, rule.workspace_id))
      return json(res, { error: 'Forbidden' }, 403)

    const payload = { ...req.body, updated_by: auth.user.id, updated_at: new Date().toISOString() }
    const { data, error } = await supabase
      .from('validation_rules')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[update-rule]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── DELETE /rules/:id — delete rule ──────────────────────────────────────────
app.delete('/rules/:id', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    const { data: rule } = await supabase.from('validation_rules').select('workspace_id').eq('id', req.params.id).single()
    if (!rule) return json(res, { error: 'Rule not found' }, 404)
    if (!canAccessWorkspace(auth.profile, rule.workspace_id))
      return json(res, { error: 'Forbidden' }, 403)

    const { error } = await supabase.from('validation_rules').delete().eq('id', req.params.id)
    if (error) throw error
    return json(res, { success: true })
  } catch (err) {
    console.error('[delete-rule]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id/alerts — alerts for a workspace ──────────────────────
app.get('/workspaces/:id/alerts', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    let query = supabase
      .from('alert_log')
      .select('*')
      .eq('workspace_id', req.params.id)
      .order('first_alerted_at', { ascending: false })

    if (req.query.active_only === 'true') {
      query = query.is('resolved_at', null)
    }

    const { data, error } = await query
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[alerts/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /all-alerts — all alerts across workspaces (admin) ───────────────────
app.get('/all-alerts', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('alert_log')
      .select('*, workspaces(name)')
      .order('first_alerted_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[all-alerts]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id/entities — entity cache rows ─────────────────────────
app.get('/workspaces/:id/entities', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    let query = supabase
      .from('entity_cache')
      .select('entity_id, entity_type, parent_id, ad_account_id, name, status, daily_budget, last_synced_at')
      .eq('workspace_id', req.params.id)

    if (req.query.entity_type) query = query.eq('entity_type', req.query.entity_type)

    const { data, error } = await query
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[entities/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /workspaces/:id/campaigns — enriched campaign view ───────────────────
app.get('/workspaces/:id/campaigns', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (!canAccessWorkspace(auth.profile, req.params.id))
      return json(res, { error: 'Forbidden' }, 403)

    const wsId = req.params.id
    const [entitiesRes, rulesRes, violationsRes] = await Promise.all([
      supabase
        .from('entity_cache')
        .select('entity_id, entity_type, parent_id, ad_account_id, name, status, daily_budget, lifetime_budget, budget_type, budget_source, campaign_budget_opt, objective, budget_change_count, last_synced_at')
        .eq('workspace_id', wsId)
        .in('entity_type', ['campaign', 'adset'])
        .order('name'),
      supabase
        .from('validation_rules')
        .select('id, entity_id, active, metric, operator, threshold, alert_name, snooze_until, created_at')
        .eq('workspace_id', wsId),
      supabase
        .from('alert_log')
        .select('id, entity_id')
        .eq('workspace_id', wsId)
        .is('resolved_at', null),
    ])

    if (entitiesRes.error) throw entitiesRes.error

    const rulesByEntity = {}
    for (const r of (rulesRes.data || [])) {
      if (!rulesByEntity[r.entity_id]) rulesByEntity[r.entity_id] = []
      rulesByEntity[r.entity_id].push(r)
    }
    const violationsByEntity = {}
    for (const v of (violationsRes.data || [])) {
      violationsByEntity[v.entity_id] = (violationsByEntity[v.entity_id] || 0) + 1
    }

    const result = (entitiesRes.data || []).map(e => ({
      ...e,
      rules:      rulesByEntity[e.entity_id]      || [],
      violations: violationsByEntity[e.entity_id] || 0,
    }))

    return json(res, result)
  } catch (err) {
    console.error('[campaigns/:id]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /cron-runs — cron execution history ──────────────────────────────────
app.get('/cron-runs', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    const limit = parseInt(req.query.limit) || 20
    const { data, error } = await supabase
      .from('cron_run_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[cron-runs]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /audit-log — rule audit log (admin) ──────────────────────────────────
app.get('/audit-log', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const limit = parseInt(req.query.limit) || 300
    const { data, error } = await supabase
      .from('rule_audit_log')
      .select('*, workspaces(name)')
      .order('changed_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[audit-log]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /invitations — all invitations (admin) ───────────────────────────────
app.get('/invitations', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('invitations')
      .select('id, workspace_id, email, sent_at, accepted_at, revoked, workspaces(name)')
      .order('sent_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[invitations]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /user-profiles — all user profiles (admin) ───────────────────────────
app.get('/user-profiles', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, role, workspace_id')
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[user-profiles]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /ad-account-map — ad account ID to name mapping ──────────────────────
app.get('/ad-account-map', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return

    const { data, error } = await supabase
      .from('workspace_ad_accounts')
      .select('ad_account_id, account_name')
    if (error) throw error
    return json(res, data)
  } catch (err) {
    console.error('[ad-account-map]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── GET /admin-dashboard — aggregated dashboard data (admin) ─────────────────
app.get('/admin-dashboard', async (req, res) => {
  try {
    const auth = await requireAuth(req, res)
    if (!auth) return
    if (auth.profile.role !== 'super_admin') return json(res, { error: 'Forbidden' }, 403)

    const [ws, runs, alerts, audit, ruleCount, campaigns, allRules] = await Promise.all([
      supabase.from('workspaces').select('*, workspace_ad_accounts(id, ad_account_id)').order('created_at', { ascending: false }).then(r => r.data || []),
      supabase.from('cron_run_log').select('*').order('started_at', { ascending: false }).limit(5).then(r => r.data || []),
      supabase.from('alert_log')
        .select('id, workspace_id, entity_name, entity_id, metric, operator, threshold, actual_value, first_alerted_at, workspaces(name)')
        .is('resolved_at', null).order('first_alerted_at', { ascending: false }).then(r => r.data || []),
      supabase.from('rule_audit_log')
        .select('id, workspace_id, action, changed_at, new_value, previous_value, workspaces(name)')
        .order('changed_at', { ascending: false }).limit(8).then(r => r.data || []),
      supabase.from('validation_rules').select('id', { count: 'exact', head: true }).eq('active', true).then(r => r.count || 0),
      supabase.from('entity_cache')
        .select('entity_id, entity_type, workspace_id, ad_account_id, name, objective, daily_budget, lifetime_budget, budget_type, status, last_synced_at')
        .eq('entity_type', 'campaign').order('name').then(r => r.data || []),
      supabase.from('validation_rules')
        .select('id, entity_id, workspace_id, active, alert_name, metric, operator, threshold, snooze_until')
        .then(r => r.data || []),
    ])

    return json(res, { workspaces: ws, syncRuns: runs, alerts, activity: audit, ruleCount, campaigns, allRules })
  } catch (err) {
    console.error('[admin-dashboard]', err)
    return json(res, { error: err.message }, 500)
  }
})

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`[server] API server listening on port ${PORT}`)
})

module.exports = app
