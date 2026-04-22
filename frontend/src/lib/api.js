import { supabase } from './supabase.js'

// ---------------------------------------------------------------------------
// Backend API helper — ALL data queries route through the backend
// Supabase client is only used for auth (login, session, signOut)
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
// Auth profile (used by AuthContext)
// ---------------------------------------------------------------------------

export async function fetchMyProfile() {
  return apiCall('/me')
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function listWorkspaces() {
  return apiCall('/workspaces')
}

export async function getWorkspace(id) {
  return apiCall(`/workspaces/${id}`)
}

export async function createWorkspace(payload) {
  return apiCall('/workspaces', { method: 'POST', body: payload })
}

export async function updateWorkspace(id, payload) {
  return apiCall(`/workspaces/${id}`, { method: 'PATCH', body: payload })
}

// ---------------------------------------------------------------------------
// Ad Accounts
// ---------------------------------------------------------------------------

export async function listAdAccounts(workspaceId) {
  return apiCall(`/workspaces/${workspaceId}/ad-accounts`)
}

// ---------------------------------------------------------------------------
// Validation Rules
// ---------------------------------------------------------------------------

export async function listRules(workspaceId) {
  return apiCall(`/workspaces/${workspaceId}/rules`)
}

export async function listAllRules() {
  return apiCall('/all-rules')
}

export async function createRule(payload) {
  return apiCall('/rules', { method: 'POST', body: payload })
}

export async function updateRule(id, payload) {
  return apiCall(`/rules/${id}`, { method: 'PATCH', body: payload })
}

export async function deleteRule(id) {
  return apiCall(`/rules/${id}`, { method: 'DELETE' })
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
  const qs = activeOnly ? '?active_only=true' : ''
  return apiCall(`/workspaces/${workspaceId}/alerts${qs}`)
}

export async function listAllAlerts() {
  return apiCall('/all-alerts')
}

// ---------------------------------------------------------------------------
// Entity Cache (for EntityPicker)
// ---------------------------------------------------------------------------

export async function listEntities(workspaceId, entityType = null) {
  const qs = entityType ? `?entity_type=${entityType}` : ''
  return apiCall(`/workspaces/${workspaceId}/entities${qs}`)
}

// ---------------------------------------------------------------------------
// Campaigns View (enriched: entities + rules + violations)
// ---------------------------------------------------------------------------

const CAMPAIGNS_CACHE_TTL = 10 * 60 * 1000 // 10 min

export async function listCampaignsView(workspaceId, { bust = false } = {}) {
  const cacheKey = `sg_campaigns_view_${workspaceId}`

  if (!bust) {
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const { ts, data } = JSON.parse(cached)
        if (Date.now() - ts < CAMPAIGNS_CACHE_TTL) return data
      }
    } catch { /* ignore */ }
  }

  const result = await apiCall(`/workspaces/${workspaceId}/campaigns`)

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: result }))
  } catch { /* quota exceeded */ }

  return result
}

// ---------------------------------------------------------------------------
// Invitations & User Management
// ---------------------------------------------------------------------------

export async function sendInvite(workspaceId, email) {
  return apiCall('/send-invite', { method: 'POST', body: { workspace_id: workspaceId, email } })
}

export async function removeUser(workspaceId) {
  return apiCall('/remove-user', { method: 'POST', body: { workspace_id: workspaceId } })
}

const AD_ACCOUNTS_CACHE_KEY = 'sg_ad_accounts_cache'
const AD_ACCOUNTS_CACHE_TTL = 30 * 60 * 1000

export async function fetchAdAccounts({ bust = false } = {}) {
  if (!bust) {
    try {
      const cached = sessionStorage.getItem(AD_ACCOUNTS_CACHE_KEY)
      if (cached) {
        const { ts, data } = JSON.parse(cached)
        if (Date.now() - ts < AD_ACCOUNTS_CACHE_TTL) return data
      }
    } catch { /* ignore */ }
  }
  const data = await apiCall('/ad-accounts')
  try {
    sessionStorage.setItem(AD_ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }))
  } catch { /* quota exceeded */ }
  return data
}

export async function linkAdAccount(payload) {
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
// Cron Run Log
// ---------------------------------------------------------------------------

export async function listCronRuns(limit = 20) {
  return apiCall(`/cron-runs?limit=${limit}`)
}

// ---------------------------------------------------------------------------
// Admin: Audit Log + Invitations + User Profiles + Ad Account Map
// ---------------------------------------------------------------------------

export async function listAllAuditLog(limit = 300) {
  return apiCall(`/audit-log?limit=${limit}`)
}

export async function listAllInvitations(limit = 200) {
  return apiCall(`/invitations?limit=${limit}`)
}

export async function listUserProfiles() {
  return apiCall('/user-profiles')
}

export async function listAdAccountMap() {
  return apiCall('/ad-account-map')
}

// ---------------------------------------------------------------------------
// Admin Dashboard (single aggregated call)
// ---------------------------------------------------------------------------

export async function fetchAdminDashboard() {
  return apiCall('/admin-dashboard')
}
