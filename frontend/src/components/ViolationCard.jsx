export default function ViolationCard({ alert }) {
  const isActive = !alert.resolved_at

  return (
    <div style={{
      border: `1px solid ${isActive ? '#fca5a5' : '#d1d5db'}`,
      borderLeft: `4px solid ${isActive ? '#dc2626' : '#9ca3af'}`,
      borderRadius: 6,
      padding: '0.75rem 1rem',
      background: isActive ? '#fff5f5' : '#fafafa',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <strong>{alert.entity_name}</strong>
        <span style={{
          fontSize: '0.75rem',
          padding: '2px 8px',
          borderRadius: 12,
          background: isActive ? '#fee2e2' : '#f3f4f6',
          color: isActive ? '#991b1b' : '#6b7280',
        }}>
          {isActive ? 'Active' : 'Resolved'}
        </span>
      </div>
      <div style={{ fontSize: '0.85rem', color: '#555', marginTop: 4 }}>
        <span>{alert.metric} {alert.operator} {alert.threshold}</span>
        <span style={{ marginLeft: '0.5rem', color: '#dc2626' }}>
          (actual: {alert.actual_value})
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>
        First seen: {new Date(alert.first_alerted_at).toLocaleString()}
        {alert.resolved_at && ` · Resolved: ${new Date(alert.resolved_at).toLocaleString()}`}
      </div>
    </div>
  )
}
