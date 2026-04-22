'use strict'

/**
 * Build the HTML alert email for a set of violations belonging to one email address.
 * violations: violation[] (all for the same notification_email)
 */
function buildAlertEmail(violations, frontendUrl) {
  // Group by ad_account_id
  const byAccount = {}
  for (const v of violations) {
    if (!byAccount[v.ad_account_id]) byAccount[v.ad_account_id] = []
    byAccount[v.ad_account_id].push(v)
  }

  const accountBlocks = Object.entries(byAccount).map(([accountId, items]) => {
    const rows = items.map(v => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escHtml(v.entity_name || v.entity_id)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;">${escHtml(v.entity_type)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escHtml(v.alert_name || '—')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escHtml(v.metric)} ${escHtml(v.operator)} ${escHtml(v.threshold)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:600;">${escHtml(v.actual_value)}</td>
      </tr>
    `).join('')

    return `
      <h3 style="margin:24px 0 8px;font-size:14px;color:#374151;">Account: ${escHtml(accountId)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f9fafb;text-align:left;">
            <th style="padding:8px 12px;font-weight:600;color:#374151;">Entity</th>
            <th style="padding:8px 12px;font-weight:600;color:#374151;">Type</th>
            <th style="padding:8px 12px;font-weight:600;color:#374151;">Alert</th>
            <th style="padding:8px 12px;font-weight:600;color:#374151;">Rule</th>
            <th style="padding:8px 12px;font-weight:600;color:#374151;">Actual</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `
  }).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">SpendGuard Alert</h1>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
      The following rules were breached in yesterday's data.
    </p>

    ${accountBlocks}

    <p style="margin-top:32px;font-size:13px;color:#9ca3af;">
      View full details and manage rules in
      <a href="${frontendUrl}/workspace" style="color:#2563eb;">SpendGuard portal</a>.
    </p>
  </div>
</body>
</html>
  `.trim()
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { buildAlertEmail }
