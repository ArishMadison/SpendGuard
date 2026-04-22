const { supabase } = require('./supabaseClient')

/**
 * Load all active ad accounts across all active workspaces.
 */
async function loadActiveAdAccounts() {
  const { data: activeWorkspaces, error: wsErr } = await supabase
    .from('workspaces')
    .select('id')
    .eq('is_active', true)
  if (wsErr) throw wsErr

  const wsIds = activeWorkspaces.map(w => w.id)
  if (wsIds.length === 0) return []

  const { data, error } = await supabase
    .from('workspace_ad_accounts')
    .select('id, workspace_id, ad_account_id, account_name, access_token')
    .eq('is_active', true)
    .in('workspace_id', wsIds)

  if (error) throw error
  return data
}

/**
 * Load all active rules with their ad account token and workspace notification email.
 *
 * Uses three separate queries and joins in memory because there is no FK between
 * validation_rules.ad_account_id and workspace_ad_accounts.ad_account_id — Supabase
 * PostgREST cannot resolve that relationship automatically.
 *
 * Returns [] with no error when no active rules exist.
 */
async function loadActiveRules() {
  // Step 1: load active, non-snoozed rules
  const { data: rules, error: rulesErr } = await supabase
    .from('validation_rules')
    .select('id, workspace_id, ad_account_id, entity_type, entity_id, entity_name, metric, operator, threshold, alert_name')
    .eq('active', true)
    .or(`snooze_until.is.null,snooze_until.lt.${new Date().toISOString()}`)

  if (rulesErr) throw rulesErr
  if (!rules || rules.length === 0) {
    console.log('[loadActiveRules] No active rules found — skipping metric fetch')
    return []
  }

  // Step 2: load active workspaces that have at least one rule
  const wsIds = [...new Set(rules.map(r => r.workspace_id))]
  const { data: workspaces, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, notification_email, is_active')
    .in('id', wsIds)
    .eq('is_active', true)

  if (wsErr) throw wsErr
  const wsMap = Object.fromEntries((workspaces || []).map(w => [w.id, w]))

  // Step 3: load active ad accounts for those workspaces
  const adAccountIds = [...new Set(rules.map(r => r.ad_account_id))]
  const { data: adAccounts, error: aaErr } = await supabase
    .from('workspace_ad_accounts')
    .select('workspace_id, ad_account_id, access_token, is_active')
    .in('ad_account_id', adAccountIds)
    .eq('is_active', true)

  if (aaErr) throw aaErr
  // Key by "workspaceId:adAccountId" to handle same ad account across workspaces
  const aaMap = Object.fromEntries(
    (adAccounts || []).map(a => [`${a.workspace_id}:${a.ad_account_id}`, a])
  )

  // Step 4: join — drop rules whose workspace or ad account is inactive/missing
  return rules
    .filter(r => wsMap[r.workspace_id] && aaMap[`${r.workspace_id}:${r.ad_account_id}`])
    .map(r => ({
      ...r,
      access_token:       aaMap[`${r.workspace_id}:${r.ad_account_id}`].access_token,
      notification_email: wsMap[r.workspace_id].notification_email,
    }))
}

/**
 * Get a single entity_cache row by entity_id.
 */
async function getEntityCache(entityId) {
  const { data, error } = await supabase
    .from('entity_cache')
    .select(`
      entity_id, entity_type, parent_id, ad_account_id, workspace_id,
      name, status, daily_budget, lifetime_budget, budget_type, budget_source,
      campaign_budget_opt, objective, meta_created_time,
      budget_change_count, last_budget_changed_at, last_synced_at
    `)
    .eq('entity_id', entityId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * Fetch ALL existing entity_cache rows for an ad account in one query.
 * Used by entitySync to avoid N+1 lookups when computing budget change counts.
 * Returns a Map<entity_id, row>.
 */
async function getEntityCacheMapForAccount(adAccountId) {
  const { data, error } = await supabase
    .from('entity_cache')
    .select('entity_id, daily_budget, lifetime_budget, budget_change_count, last_budget_changed_at')
    .eq('ad_account_id', adAccountId)

  if (error) throw error
  const map = new Map()
  for (const row of (data || [])) map.set(row.entity_id, row)
  return map
}

/**
 * Count campaigns launched in the current calendar month for an ad account.
 * Used for campaign_frequency_monthly metric.
 */
async function countCampaignsLaunchedThisMonth(adAccountId) {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data, error, count } = await supabase
    .from('entity_cache')
    .select('entity_id', { count: 'exact', head: true })
    .eq('ad_account_id', adAccountId)
    .eq('entity_type', 'campaign')
    .gte('meta_created_time', startOfMonth.toISOString())

  if (error) throw error
  return count || 0
}

/**
 * Find an existing unresolved alert for a rule.
 */
async function findActiveAlert(ruleId) {
  const { data, error } = await supabase
    .from('alert_log')
    .select('id, last_alerted_at')
    .eq('rule_id', ruleId)
    .is('resolved_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * Insert a new alert log row.
 */
async function insertAlert(violation) {
  const { error } = await supabase.from('alert_log').insert({
    workspace_id:     violation.workspace_id,
    rule_id:          violation.rule_id,
    entity_id:        violation.entity_id,
    entity_name:      violation.entity_name,
    metric:           violation.metric,
    operator:         violation.operator,
    threshold:        violation.threshold,
    actual_value:     violation.actual_value,
    first_alerted_at: new Date().toISOString(),
    last_alerted_at:  new Date().toISOString(),
    notified:         true,
  })
  if (error) throw error
}

/**
 * Update last_alerted_at on an existing active alert.
 */
async function touchAlert(alertId) {
  const { error } = await supabase
    .from('alert_log')
    .update({ last_alerted_at: new Date().toISOString() })
    .eq('id', alertId)
  if (error) throw error
}

/**
 * Resolve all alerts that are no longer violating.
 * violatedRuleIds: Set<number>
 * activeWorkspaceIds: number[]
 */
async function resolveCleared(violatedRuleIds, activeWorkspaceIds) {
  if (activeWorkspaceIds.length === 0) return

  let query = supabase
    .from('alert_log')
    .update({ resolved_at: new Date().toISOString() })
    .is('resolved_at', null)
    .in('workspace_id', activeWorkspaceIds)

  if (violatedRuleIds.size > 0) {
    query = query.not('rule_id', 'in', `(${[...violatedRuleIds].join(',')})`)
  }

  const { error } = await query
  if (error) throw error
}

/**
 * Upsert entity cache rows.
 */
async function upsertEntities(entities) {
  if (entities.length === 0) return
  const { error } = await supabase
    .from('entity_cache')
    .upsert(entities, { onConflict: 'entity_id' })
  if (error) throw error
}

/**
 * Remove entity_cache rows for a specific ad account that were NOT refreshed
 * in the current sync run (i.e. last_synced_at < syncTimestamp).
 * This immediately purges entities that are no longer ACTIVE on Meta.
 */
async function purgeUnsyncedForAccount(adAccountId, syncTimestamp) {
  const { error, count } = await supabase
    .from('entity_cache')
    .delete({ count: 'exact' })
    .eq('ad_account_id', adAccountId)
    .lt('last_synced_at', syncTimestamp)

  if (error) throw error
  return count || 0
}

/**
 * Delete entity_cache rows not seen in the last `daysOld` days.
 * An entity not updated by any sync for 30+ days is assumed gone from Meta.
 */
async function purgeStaleEntities(daysOld = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysOld)

  const { error, count } = await supabase
    .from('entity_cache')
    .delete({ count: 'exact' })
    .lt('last_synced_at', cutoff.toISOString())

  if (error) throw error
  return count || 0
}

/**
 * Insert a cron_run_log row (returns the id).
 */
async function startCronLog() {
  const { data, error } = await supabase
    .from('cron_run_log')
    .insert({ status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

/**
 * Update cron_run_log row on completion.
 */
async function finishCronLog(id, stats) {
  const { error } = await supabase
    .from('cron_run_log')
    .update({
      finished_at:          new Date().toISOString(),
      status:               stats.failed ? 'failed' : 'completed',
      workspaces_processed: stats.workspacesProcessed,
      rules_evaluated:      stats.rulesEvaluated,
      violations_found:     stats.violationsFound,
      new_violations:       stats.newViolations,
      emails_sent:          stats.emailsSent,
      errors:               stats.errors.length > 0 ? stats.errors : null,
    })
    .eq('id', id)
  if (error) console.error('Failed to update cron_run_log:', error)
}

module.exports = {
  loadActiveAdAccounts,
  loadActiveRules,
  getEntityCache,
  getEntityCacheMapForAccount,
  countCampaignsLaunchedThisMonth,
  findActiveAlert,
  insertAlert,
  touchAlert,
  resolveCleared,
  upsertEntities,
  purgeUnsyncedForAccount,
  purgeStaleEntities,
  startCronLog,
  finishCronLog,
}
