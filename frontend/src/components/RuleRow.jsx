import { useState } from 'react'
import { toggleRule, deleteRule } from '../lib/api.js'

const METRIC_LABELS = {
  budget_threshold:               'Budget threshold',
  campaign_frequency_monthly:     'Campaign frequency (monthly)',
  budget_change_frequency_monthly:'Budget change frequency (monthly)',
}

function formatCondition(rule) {
  if (rule.metric === 'budget_threshold') {
    // threshold stored as 'daily:5000' or 'lifetime_remaining:10000'
    const [mode, value] = rule.threshold.split(':')
    const modeLabel = mode === 'daily' ? 'Daily budget' : 'Lifetime remaining'
    return `${modeLabel} ${rule.operator} ${value}`
  }
  return `${METRIC_LABELS[rule.metric] || rule.metric} ${rule.operator} ${rule.threshold}`
}

export default function RuleRow({ rule, onChanged }) {
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    setLoading(true)
    try {
      await toggleRule(rule.id, !rule.active)
      onChanged()
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this rule?')) return
    setLoading(true)
    try {
      await deleteRule(rule.id)
      onChanged()
    } finally {
      setLoading(false)
    }
  }

  const isSnoozed = rule.snooze_until && new Date(rule.snooze_until) > new Date()

  return (
    <tr style={{ opacity: loading ? 0.5 : 1, borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '0.5rem' }}>{rule.alert_name || '—'}</td>
      <td style={{ padding: '0.5rem', fontSize: '0.85rem', color: '#555' }}>
        {rule.entity_name} <em>({rule.entity_type})</em>
      </td>
      <td style={{ padding: '0.5rem' }}>{formatCondition(rule)}</td>
      <td style={{ padding: '0.5rem' }}>
        <span style={{
          padding: '2px 8px',
          borderRadius: 12,
          fontSize: '0.78rem',
          background: isSnoozed ? '#fef3c7' : rule.active ? '#d1fae5' : '#fee2e2',
          color:      isSnoozed ? '#92400e' : rule.active ? '#065f46' : '#991b1b',
        }}>
          {isSnoozed ? 'Snoozed' : rule.active ? 'Active' : 'Paused'}
        </span>
      </td>
      <td style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={handleToggle} disabled={loading}>
          {rule.active ? 'Pause' : 'Resume'}
        </button>
        <button onClick={handleDelete} disabled={loading} style={{ color: '#dc2626' }}>
          Delete
        </button>
      </td>
    </tr>
  )
}
