'use strict'

/**
 * Evaluate a single rule against fetched metrics + entity cache data.
 * Returns a violation object or null if no breach.
 *
 * Supported metrics (Budget Intelligence Layer):
 *   budget_threshold              — CBO-aware daily or lifetime-remaining budget check
 *   campaign_frequency_monthly    — count of campaigns launched this month for an ad account
 *   budget_change_frequency_monthly — count of budget edits this month for an entity
 */

async function evaluate(rule, metrics, entity, db) {
  if (!entity) {
    console.warn(`[evaluator] Rule ${rule.id}: entity ${rule.entity_id} not found in cache — skipping`)
    return null
  }

  // -----------------------------------------------------------------------
  // campaign_objective — string match on entity.objective
  // -----------------------------------------------------------------------
  if (rule.metric === 'campaign_objective') {
    const actual   = (entity.objective || '').toUpperCase()
    const expected = (rule.threshold || '').toUpperCase()
    const match    = actual === expected
    const breached = rule.operator === 'equals_string' ? match : rule.operator === 'not_equals_string' ? !match : false
    if (!breached) return null
    return buildViolation(rule, actual)
  }

  // -----------------------------------------------------------------------
  // budget_level — check entity.budget_source ('campaign' or 'adset')
  // -----------------------------------------------------------------------
  if (rule.metric === 'budget_level') {
    const actual   = (entity.budget_source || 'unknown').toLowerCase()
    const expected = (rule.threshold || '').toLowerCase()
    const match    = actual === expected
    const breached = rule.operator === 'equals_string' ? match : rule.operator === 'not_equals_string' ? !match : false
    if (!breached) return null
    return buildViolation(rule, actual)
  }

  // -----------------------------------------------------------------------
  // budget_type — check entity.budget_type ('daily' or 'lifetime')
  // -----------------------------------------------------------------------
  if (rule.metric === 'budget_type') {
    const actual   = (entity.budget_type || 'unknown').toLowerCase()
    const expected = (rule.threshold || '').toLowerCase()
    const match    = actual === expected
    const breached = rule.operator === 'equals_string' ? match : rule.operator === 'not_equals_string' ? !match : false
    if (!breached) return null
    return buildViolation(rule, actual)
  }

  // -----------------------------------------------------------------------
  // budget_threshold
  // -----------------------------------------------------------------------
  if (rule.metric === 'budget_threshold') {
    const isCBO = entity.campaign_budget_opt === true

    if (rule.entity_type === 'adset' && isCBO) {
      console.warn(`[evaluator] Rule ${rule.id}: adset budget rule skipped — campaign uses CBO`)
      return null
    }

    // Parse threshold prefix: 'daily:5000' or 'lifetime_remaining:10000'
    const [budgetMode, rawThreshold] = rule.threshold.split(':')
    const threshold = parseFloat(rawThreshold)
    if (isNaN(threshold)) {
      console.warn(`[evaluator] Rule ${rule.id}: invalid threshold format "${rule.threshold}" — expected daily:N or lifetime_remaining:N`)
      return null
    }

    let effectiveBudget
    if (budgetMode === 'daily') {
      effectiveBudget = entity.daily_budget // already converted from cents on sync
      if (effectiveBudget == null) {
        console.warn(`[evaluator] Rule ${rule.id}: daily_budget is null for entity ${rule.entity_id} — skipping`)
        return null
      }
    } else if (budgetMode === 'lifetime_remaining') {
      if (entity.lifetime_budget == null) {
        console.warn(`[evaluator] Rule ${rule.id}: lifetime_budget is null for entity ${rule.entity_id} — skipping`)
        return null
      }
      const totalSpend = parseFloat(metrics?.spend || 0)
      effectiveBudget = entity.lifetime_budget - totalSpend
    } else {
      console.warn(`[evaluator] Rule ${rule.id}: unknown budget mode "${budgetMode}" — skipping`)
      return null
    }

    // Override rule.threshold with the numeric part for comparison
    const syntheticRule = { ...rule, threshold: String(threshold) }
    return compareNumeric(syntheticRule, effectiveBudget)
  }

  // -----------------------------------------------------------------------
  // campaign_frequency_monthly
  // -----------------------------------------------------------------------
  if (rule.metric === 'campaign_frequency_monthly') {
    const count = await db.countCampaignsLaunchedThisMonth(rule.ad_account_id)
    return compareNumeric(rule, count)
  }

  // -----------------------------------------------------------------------
  // budget_change_frequency_monthly
  // -----------------------------------------------------------------------
  if (rule.metric === 'budget_change_frequency_monthly') {
    const count = entity.budget_change_count || 0
    return compareNumeric(rule, count)
  }

  console.warn(`[evaluator] Rule ${rule.id}: unknown metric "${rule.metric}" — skipping`)
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareNumeric(rule, actual) {
  const threshold = parseFloat(rule.threshold)
  if (isNaN(actual) || isNaN(threshold)) return null

  const breached =
    rule.operator === '<' ? actual < threshold :
    rule.operator === '>' ? actual > threshold :
    rule.operator === '=' ? actual === threshold : false

  if (!breached) return null
  return buildViolation(rule, String(actual))
}

function buildViolation(rule, actual) {
  return {
    rule_id:       rule.id,
    workspace_id:  rule.workspace_id,
    entity_id:     rule.entity_id,
    entity_name:   rule.entity_name,
    entity_type:   rule.entity_type,
    alert_name:    rule.alert_name,
    metric:        rule.metric,
    operator:      rule.operator,
    threshold:     rule.threshold,
    actual_value:  actual,
    message:       `${rule.metric} is ${actual} (rule: ${rule.operator} ${rule.threshold})`,
    diff: (!isNaN(parseFloat(actual)) && !isNaN(parseFloat(rule.threshold)))
          ? Math.abs(parseFloat(actual) - parseFloat(rule.threshold)).toFixed(2)
          : null,
    notification_email: rule.notification_email,
    ad_account_id:      rule.ad_account_id,
  }
}

module.exports = { evaluate, compareNumeric, buildViolation }
