import { supabase } from './supabase.js'

// ---------------------------------------------------------------------------
// Node.js API server helper
// ---------------------------------------------------------------------------

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export async function apiCall(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }

  if (auth) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`)
  return data
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function listWorkspaces() {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*, user_profiles(role), workspace_ad_accounts(id, ad_account_id)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getWorkspace(id) {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*, workspace_ad_accounts(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createWorkspace(payload) {
  const { data, error } = await supabase
    .from('workspaces')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateWorkspace(id, payload) {
  const { data, error } = await supabase
    .from('workspaces')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Ad Accounts
// ---------------------------------------------------------------------------

export async function listAdAccounts(workspaceId) {
  const { data, error } = await supabase
    .from('workspace_ad_accounts')
    .select('id, workspace_id, ad_account_id, account_name, is_active, linked_at')
    .eq('workspace_id', workspaceId)
    .order('linked_at', { ascending: false })
  if (error) throw error
  return data
  // NOTE: access_token is intentionally excluded from this select
}

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

export async function listRules(workspaceId) {
  const { data, error } = await supabase
    .from('validation_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createRule(payload) {
  const { data, error } = await supabase
    .from('validation_rules')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateRule(id, payload) {
  const { data, error } = await supabase
    .from('validation_rules')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteRule(id) {
  const { error } = await supabase
    .from('validation_rules')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function toggleRule(id, active) {
  return updateRule(id, { active })
}

export async function snoozeRule(id, snoozeUntil) {
  return updateRule(id, { snooze_until: snoozeUntil })
}

// ---------------------------------------------------------------------------
// Alert Log
// ---------------------------------------------------------------------------

export async function listAlerts(workspaceId, { activeOnly = false } = {}) {
  let query = supabase
    .from('alert_log')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('first_alerted_at', { ascending: false })

  if (activeOnly) query = query.is('resolved_at', null)

  const { data, error } = await query
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Entity Cache
// ---------------------------------------------------------------------------

export async function listEntities(workspaceId, entityType = null) {
  let query = supabase
    .from('entity_cache')
    .select('entity_id, entity_type, parent_id, ad_account_id, name, status, daily_budget, last_synced_at')
    .eq('workspace_id', workspaceId)

  if (entityType) query = query.eq('entity_type', entityType)

  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Fetch campaigns + adsets for a workspace, enriched with per-entity rule and
 * active-violation counts. Cached in sessionStorage for 10 minutes.
 * Pass { bust: true } to force a fresh fetch.
 */
export async function listCampaignsView(workspaceId, { bust = false } = {}) {
  const cacheKey = `sg_campaigns_view_${workspaceId}`
  const TTL = 10 * 60 * 1000 // 10 min

  if (!bust) {
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const { ts, data } = JSON.parse(cached)
        if (Date.now() - ts < TTL) return data
      }
    } catch { /* ignore */ }
  }

  const [entitiesRes, rulesRes, violationsRes] = await Promise.all([
    supabase
      .from('entity_cache')
      .select('entity_id, entity_type, parent_id, ad_account_id, name, status, daily_budget, lifetime_budget, budget_type, budget_source, campaign_budget_opt, objective, budget_change_count, last_synced_at')
      .eq('workspace_id', workspaceId)
      .in('entity_type', ['campaign', 'adset'])
      .order('name'),
    supabase
      .from('validation_rules')
      .select('id, entity_id, active, metric, operator, threshold, alert_name, snooze_until, created_at')
      .eq('workspace_id', workspaceId),
    supabase
      .from('alert_log')
      .select('id, entity_id')
      .eq('workspace_id', workspaceId)
      .is('resolved_at', null),
  ])

  if (entitiesRes.error) throw entitiesRes.error

  // Count rules and violations per entity
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

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: result }))
  } catch { /* quota exceeded */ }

  return result
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function sendInvite(workspaceId, email) {
  return apiCall('/send-invite', { method: 'POST', body: { workspace_id: workspaceId, email } })
}

export async function removeUser(workspaceId) {
  // Fully removes the workspace user via backend (service role can delete auth users)
  return apiCall('/remove-user', { method: 'POST', body: { workspace_id: workspaceId } })
}

const AD_ACCOUNTS_CACHE_KEY = 'sg_ad_accounts_cache'
const AD_ACCOUNTS_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export async function fetchAdAccounts({ bust = false } = {}) {
  if (!bust) {
    try {
      const cached = sessionStorage.getItem(AD_ACCOUNTS_CACHE_KEY)
      if (cached) {
        const { ts, data } = JSON.parse(cached)
        if (Date.now() - ts < AD_ACCOUNTS_CACHE_TTL) return data
      }
    } catch { /* ignore parse errors */ }
  }
  const data = await apiCall('/ad-accounts', { method: 'GET' })
  try {
    sessionStorage.setItem(AD_ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch { /* quota exceeded — skip cache */ }
  return data
}

export async function linkAdAccount(payload) {
  // access_token is intentionally not included — backend uses SYSTEM_USER_TOKEN
  const { workspace_id, ad_account_id, account_name } = payload
  return apiCall('/link-ad-account', { method: 'POST', body: { workspace_id, ad_account_id, account_name } })
}

export async function validateEntity(entityId, workspaceId) {
  return apiCall(`/validate-entity?entity_id=${encodeURIComponent(entityId)}&workspace_id=${workspaceId}`)
}

export async function refreshEntityCache(workspaceId, adAccountId) {
  return apiCall('/refresh-entity-cache', { method: 'POST', body: { workspace_id: workspaceId, ad_account_id: adAccountId } })
}

// ---------------------------------------------------------------------------
// Rule Audit Log
// ---------------------------------------------------------------------------

export async function listRuleAudit(workspaceId) {
  const { data, error } = await supabase
    .from('rule_audit_log')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Cron Run Log (super admin)
// ---------------------------------------------------------------------------

export async function listCronRuns(limit = 20) {
  const { data, error } = await supabase
    .from('cron_run_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Admin Audit + Invitation Log (super admin)
// ---------------------------------------------------------------------------

export async function listAllAuditLog(limit = 300) {
  const { data, error } = await supabase
    .from('rule_audit_log')
    .select('*, workspaces(name)')
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function listAllInvitations(limit = 200) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, workspace_id, email, sent_at, accepted_at, revoked, workspaces(name)')
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}
