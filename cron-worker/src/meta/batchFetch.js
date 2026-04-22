'use strict'

const axios = require('axios')

const META_API_VERSION = 'v19.0'
const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}/`
const BATCH_SIZE = 50

// Fields fetched per entity in the cron evaluation batch.
// budget_threshold needs spend to compute lifetime_remaining.
// campaign_frequency_monthly and budget_change_frequency_monthly
// don't use insights — they use entity_cache columns directly.
const ENTITY_FIELDS = [
  'id', 'name', 'status', 'effective_status',
  'daily_budget', 'lifetime_budget', 'budget_remaining',
  'campaign_budget_optimization',
  'insights.date_preset(yesterday){spend}',
].join(',')

/**
 * Fetch entity fields + yesterday's spend for a list of entity IDs via Meta Batch API.
 * Returns: Map<entity_id, { status, effective_status, daily_budget, lifetime_budget,
 *                           campaign_budget_optimization, insights: { data: [...] } }>
 */
async function batchFetchMetrics(entityIds, accessToken) {
  const results = new Map()
  const chunks = chunkArray(entityIds, BATCH_SIZE)

  for (const chunk of chunks) {
    const batch = chunk.map(id => ({
      method: 'GET',
      relative_url: `${id}?fields=${ENTITY_FIELDS}`,
    }))

    let response
    try {
      response = await axios.post(
        META_GRAPH_URL,
        { batch: JSON.stringify(batch), access_token: accessToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      )
    } catch (err) {
      throw new Error(`Meta Batch API request failed: ${err.message}`)
    }

    for (const item of response.data) {
      if (!item || item.code !== 200) {
        console.warn(`[batchFetch] Non-200 response: code=${item?.code}`)
        continue
      }
      try {
        const parsed = JSON.parse(item.body)
        if (parsed.error) {
          console.warn(`[batchFetch] Meta error: ${parsed.error.message}`)
          continue
        }
        results.set(parsed.id, parsed)
      } catch {
        console.warn('[batchFetch] Failed to parse batch item body')
      }
    }
  }

  return results
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

module.exports = { batchFetchMetrics }
