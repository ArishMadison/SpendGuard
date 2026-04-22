'use strict'

require('dotenv').config()
const cron = require('node-cron')
const config = require('./config')
const { runJob } = require('./runJob')

// Start API server
require('./server')

console.log(`[index] SpendGuard cron worker starting...`)
console.log(`[index] Schedule: ${config.cronSchedule}`)

if (!cron.validate(config.cronSchedule)) {
  console.error(`[index] Invalid cron schedule: ${config.cronSchedule}`)
  process.exit(1)
}

cron.schedule(config.cronSchedule, async () => {
  console.log(`[index] Cron fired at ${new Date().toISOString()}`)
  try {
    await runJob()
  } catch (err) {
    console.error('[index] Unhandled error in runJob:', err)
  }
})

// Keep process alive
console.log('[index] Cron worker running. Waiting for next scheduled run...')
