'use strict'

const sgMail = require('@sendgrid/mail')
const config = require('../config')
const { buildAlertEmail } = require('./alertTemplate')

sgMail.setApiKey(config.sendgridApiKey)

/**
 * Send alert emails grouped by notification email address.
 * newViolations: violation[] (each has notification_email field)
 * Returns count of emails sent.
 */
async function sendAlertEmails(newViolations) {
  if (newViolations.length === 0) return 0

  // Group by notification email
  const byEmail = {}
  for (const v of newViolations) {
    const email = v.notification_email
    if (!email) {
      console.warn(`[sender] No notification_email for violation rule_id=${v.rule_id} — skipping`)
      continue
    }
    if (!byEmail[email]) byEmail[email] = []
    byEmail[email].push(v)
  }

  let sent = 0
  for (const [toEmail, violations] of Object.entries(byEmail)) {
    const html = buildAlertEmail(violations, config.frontendUrl)
    const violationCount = violations.length

    try {
      await sgMail.send({
        to: toEmail,
        from: config.emailFrom,
        subject: `SpendGuard: ${violationCount} rule${violationCount !== 1 ? 's' : ''} breached`,
        html,
      })
      console.log(`[sender] Alert email sent to ${toEmail} (${violationCount} violations)`)
      sent++
    } catch (err) {
      console.error(`[sender] Failed to send to ${toEmail}:`, err.response?.body || err.message)
    }
  }

  return sent
}

module.exports = { sendAlertEmails }
