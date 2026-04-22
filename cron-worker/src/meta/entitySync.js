'use strict'

const axios = require('axios')
const { upsertEntities, getEntityCacheMapForAccount, purgeUnsyncedForAccount } = require('../db/queries')

const META_API_VERSION = 'v19.0'
const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}/`

// Only fetch entities that are currently delivering
const ACTIVE_FILTER = encodeURIComponent(
  JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }])
)

const CAMPAIGN_FIELDS = [
  'id', 'name', 'status', 'effective_status', 'objective',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
  'budget_optimization_type', 'campaign_budget_optimization',
  'created_time',
].join(',')

const ADSET_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
  'campaign_id', 'created_time',
].join(',')

const AD_FIELDS = 'id,name,status,effective_status,adset_id,created_time'

/**
 * Refresh entity_cache for a single ad account.
 * Only fetches ACTIVE entities. Uses a single batch DB read instead of N+1 per entity.
 */
async function syncEntityCache(adAccountId, accessToken, workspaceId) {
  const now = new Date().toISOString()

  // Single DB read — existing rows for budget-change tracking (no N+1)
  const existingMap = await getEntityCacheMapForAccount(adAccountId)

  const entities = []

  // ── Campaigns (ACTIVE only) ────────────────────────────────────────────────
  const campaigns = await fetchAll(
    `${adAccountId}/campaigns`, CAMPAIGN_FIELDS, accessToken, ACTIVE_FILTER
  )

  // CBO lookup for adset processing
  const campaignCBOMap = {}

  for (const c of campaigns) {
    const isCBO         = c.campaign_budget_optimization === true
    campaignCBOMap[c.id] = isCBO
    const dailyBudget    = c.daily_budget    != null ? parseInt(c.daily_budget)    / 100 : null
    const lifetimeBudget = c.lifetime_budget != null ? parseInt(c.lifetime_budget) / 100 : null
    const { changeCount, lastChangedAt } = computeBudgetChange(c, existingMap.get(c.id))

    entities.push({
      entity_id:              c.id,
      entity_type:            'campaign',
      parent_id:              null,
      ad_account_id:          adAccountId,
      workspace_id:           workspaceId,
      name:                   c.name,
      status:                 c.effective_status || c.status,
      daily_budget:           dailyBudget,
      lifetime_budget:        lifetimeBudget,
      budget_type:            dailyBudget != null ? 'daily' : lifetimeBudget != null ? 'lifetime' : null,
      budget_source:          isCBO ? 'campaign' : 'adset',
      campaign_budget_opt:    isCBO,
      objective:              c.objective || null,
      meta_created_time:      c.created_time || null,
      budget_change_count:    changeCount,
      last_budget_changed_at: lastChangedAt,
      last_synced_at:         now,
    })
  }

  // ── Adsets (ACTIVE only) ───────────────────────────────────────────────────
  const adsets = await fetchAll(
    `${adAccountId}/adsets`, ADSET_FIELDS, accessToken, ACTIVE_FILTER
  )

  for (const a of adsets) {
    const dailyBudget    = a.daily_budget    != null ? parseInt(a.daily_budget)    / 100 : null
    const lifetimeBudget = a.lifetime_budget != null ? parseInt(a.lifetime_budget) / 100 : null
    // CBO is determined by the parent campaign, not by absence of budget
    const isCBO = campaignCBOMap[a.campaign_id] === true
    const { changeCount, lastChangedAt } = computeBudgetChange(a, existingMap.get(a.id))

    entities.push({
      entity_id:              a.id,
      entity_type:            'adset',
      parent_id:              a.campaign_id,
      ad_account_id:          adAccountId,
      workspace_id:           workspaceId,
      name:                   a.name,
      status:                 a.effective_status || a.status,
      daily_budget:           dailyBudget,
      lifetime_budget:        lifetimeBudget,
      budget_type:            dailyBudget != null ? 'daily' : lifetimeBudget != null ? 'lifetime' : null,
      budget_source:          isCBO ? 'campaign' : 'adset',
      campaign_budget_opt:    isCBO,
      objective:              null,
      meta_created_time:      a.created_time || null,
      budget_change_count:    changeCount,
      last_budget_changed_at: lastChangedAt,
      last_synced_at:         now,
    })
  }

  // ── Ads (ACTIVE only) ──────────────────────────────────────────────────────
  const ads = await fetchAll(
    `${adAccountId}/ads`, AD_FIELDS, accessToken, ACTIVE_FILTER
  )

  for (const a of ads) {
    entities.push({
      entity_id:              a.id,
      entity_type:            'ad',
      parent_id:              a.adset_id,
      ad_account_id:          adAccountId,
      workspace_id:           workspaceId,
      name:                   a.name,
      status:                 a.effective_status || a.status,
      daily_budget:           null,
      lifetime_budget:        null,
      budget_type:            null,
      budget_source:          null,
      campaign_budget_opt:    false,
      objective:              null,
      meta_created_time:      a.created_time || null,
      budget_change_count:    0,
      last_budget_changed_at: null,
      last_synced_at:         now,
    })
  }

  await upsertEntities(entities)

  // Purge entities not refreshed in this sync (no longer ACTIVE on Meta)
  const purged = await purgeUnsyncedForAccount(adAccountId, now)

  console.log(
    `[entitySync] ${adAccountId}: synced ${entities.length} active entities` +
    ` (${campaigns.length} campaigns, ${adsets.length} adsets, ${ads.length} ads)` +
    (purged > 0 ? ` · purged ${purged} inactive` : '')
  )
}

/**
 * Compute budget_change_count and last_budget_changed_at.
 * Resets counter when the calendar month rolls over.
 */
function computeBudgetChange(fetched, existing) {
  const newBudget = fetched.daily_budget || fetched.lifetime_budget || null
  const oldBudget = existing
    ? ((existing.daily_budget != null ? existing.daily_budget * 100 : null)
       || (existing.lifetime_budget != null ? existing.lifetime_budget * 100 : null)
       || null)
    : null

  const budgetChanged = newBudget !== oldBudget && oldBudget !== null

  const now = new Date()
  const isNewMonth = existing?.last_budget_changed_at
    ? new Date(existing.last_budget_changed_at).getMonth() !== now.getMonth()
      || new Date(existing.last_budget_changed_at).getFullYear() !== now.getFullYear()
    : false

  let changeCount
  let lastChangedAt = existing?.last_budget_changed_at || null

  if (isNewMonth) {
    changeCount   = budgetChanged ? 1 : 0
    lastChangedAt = budgetChanged ? now.toISOString() : null
  } else {
    changeCount   = budgetChanged
      ? (existing?.budget_change_count || 0) + 1
      : (existing?.budget_change_count || 0)
    lastChangedAt = budgetChanged ? now.toISOString() : lastChangedAt
  }

  return { changeCount, lastChangedAt }
}

/**
 * Paginate through all pages of a Meta edge.
 * filter: already-encoded filtering param string (optional).
 */
async function fetchAll(edge, fields, accessToken, filter = null) {
  const results = []
  let url = `${META_GRAPH_URL}${edge}?fields=${fields}&access_token=${accessToken}&limit=200`
  if (filter) url += `&filtering=${filter}`

  while (url) {
    const { data } = await axios.get(url, { timeout: 30000 })
    if (data.error) {
      throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`)
    }
    if (data.data) results.push(...data.data)
    url = data.paging?.next || null
  }

  return results
}

module.exports = { syncEntityCache }
