'use strict'

const { syncEntityCache } = require('./meta/entitySync')
const { batchFetchMetrics } = require('./meta/batchFetch')
const { evaluate } = require('./evaluator')
const db = require('./db/queries')
const {
  loadActiveAdAccounts,
  loadActiveRules,
  findActiveAlert,
  insertAlert,
  touchAlert,
  resolveCleared,
  getEntityCache,
  purgeStaleEntities,
  startCronLog,
  finishCronLog,
} = db
const { sendAlertEmails } = require('./email/sender')

async function runJob() {
  console.log(`[runJob] Starting cron job at ${new Date().toISOString()}`)

  const stats = {
    workspacesProcessed: 0,
    rulesEvaluated: 0,
    violationsFound: 0,
    newViolations: 0,
    emailsSent: 0,
    errors: [],
    failed: false,
  }

  // STEP 0: Record start
  let cronLogId
  try {
    cronLogId = await startCronLog()
  } catch (err) {
    console.error('[runJob] Failed to create cron_run_log row:', err.message)
  }

  try {
    // STEP 1: Refresh entity cache
    console.log('[runJob] Step 1: Refreshing entity cache...')
    const adAccounts = await loadActiveAdAccounts()
    const workspaceIds = new Set(adAccounts.map(a => a.workspace_id))
    stats.workspacesProcessed = workspaceIds.size

    for (const account of adAccounts) {
      try {
        await syncEntityCache(account.ad_account_id, account.access_token, account.workspace_id)
      } catch (err) {
        const msg = `entitySync failed for ${account.ad_account_id}: ${err.message}`
        console.error('[runJob]', msg)
        stats.errors.push({ type: 'entitySync', account: account.ad_account_id, message: err.message })
      }
    }

    // STEP 1.5: Purge entities not seen in 30 days
    try {
      const purged = await purgeStaleEntities(30)
      if (purged > 0) console.log(`[runJob] Purged ${purged} stale entity_cache rows (inactive >30 days)`)
    } catch (err) {
      console.warn('[runJob] purgeStaleEntities failed (non-fatal):', err.message)
    }

    // STEP 2: Load active rules
    console.log('[runJob] Step 2: Loading active rules...')
    const rules = await loadActiveRules()
    stats.rulesEvaluated = rules.length
    console.log(`[runJob] ${rules.length} active rules found`)

    // STEP 3: Group rules by ad_account_id, batch-fetch metrics
    console.log('[runJob] Step 3: Fetching metrics from Meta...')
    const byAccount = {}
    for (const rule of rules) {
      if (!byAccount[rule.ad_account_id]) {
        byAccount[rule.ad_account_id] = { accessToken: rule.access_token, entityIds: new Set() }
      }
      byAccount[rule.ad_account_id].entityIds.add(rule.entity_id)
    }

    const metricMap = new Map() // entity_id → metrics object
    for (const [accountId, { accessToken, entityIds }] of Object.entries(byAccount)) {
      try {
        const results = await batchFetchMetrics([...entityIds], accessToken)
        for (const [entityId, metrics] of results) {
          metricMap.set(entityId, metrics)
        }
      } catch (err) {
        const msg = `batchFetch failed for ${accountId}: ${err.message}`
        console.error('[runJob]', msg)
        stats.errors.push({ type: 'batchFetch', account: accountId, message: err.message })
      }
    }

    // STEP 4: Evaluate rules
    console.log('[runJob] Step 4: Evaluating rules...')
    const violations = []
    for (const rule of rules) {
      const metrics = metricMap.get(rule.entity_id)
      const entity  = await getEntityCache(rule.entity_id)
      const violation = await evaluate(rule, metrics, entity, db)
      if (violation) violations.push(violation)
    }
    stats.violationsFound = violations.length
    console.log(`[runJob] ${violations.length} violations found`)

    // STEP 5: Deduplicate — only insert new violations
    console.log('[runJob] Step 5: Deduplicating...')
    const newViolations = []
    const violatedRuleIds = new Set()

    for (const v of violations) {
      violatedRuleIds.add(v.rule_id)
      const existing = await findActiveAlert(v.rule_id)
      if (!existing) {
        await insertAlert(v)
        newViolations.push(v)
      } else {
        await touchAlert(existing.id)
      }
    }
    stats.newViolations = newViolations.length
    console.log(`[runJob] ${newViolations.length} new violations`)

    // STEP 6: Resolve cleared rules
    console.log('[runJob] Step 6: Resolving cleared alerts...')
    await resolveCleared(violatedRuleIds, [...workspaceIds])

    // STEP 7: Send alert emails
    console.log('[runJob] Step 7: Sending alert emails...')
    if (newViolations.length === 0) {
      console.log('[runJob] No new violations — no emails sent')
    } else {
      stats.emailsSent = await sendAlertEmails(newViolations)
    }

  } catch (err) {
    console.error('[runJob] Fatal error:', err)
    stats.errors.push({ type: 'fatal', message: err.message })
    stats.failed = true
  }

  // STEP 8: Update cron log
  if (cronLogId) {
    await finishCronLog(cronLogId, stats)
  }

  console.log(`[runJob] Done. Stats:`, JSON.stringify(stats))
  return stats
}

module.exports = { runJob }
