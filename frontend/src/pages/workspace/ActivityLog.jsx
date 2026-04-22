import { useEffect, useState } from 'react'
import { listAlerts } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'

export default function ActivityLog() {
  const { profile } = useAuth()
  const wsId = profile?.workspace_id

  const [alerts,  setAlerts]  = useState([])
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!wsId) return
    listAlerts(wsId).then(setAlerts).finally(() => setLoading(false))
  }, [wsId])

  const filtered = alerts.filter(a => {
    if (filter === 'active'   && a.resolved_at)  return false
    if (filter === 'resolved' && !a.resolved_at) return false
    if (search) {
      const q = search.toLowerCase()
      return (a.entity_name || a.entity_id || '').toLowerCase().includes(q) ||
             (a.metric || '').toLowerCase().includes(q) ||
             (a.alert_name || '').toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Alerts</h1>
          <p className="text-sm text-slate-500 mt-0.5">{alerts.length} total · {alerts.filter(a => !a.resolved_at).length} active</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {['all', 'active', 'resolved'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}>
              {f}
            </button>
          ))}
        </div>
        <input className="input w-64" placeholder="Search by entity, metric..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-500">No alerts found.</p>
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Actual value</th>
                <th>Status</th>
                <th>First seen</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id}>
                  <td>
                    <p className="font-medium text-slate-900 truncate max-w-xs">{a.entity_name || a.entity_id}</p>
                    {a.alert_name && <p className="text-xs text-slate-400">{a.alert_name}</p>}
                  </td>
                  <td><span className="badge-blue">{a.metric}</span></td>
                  <td className="font-mono text-xs text-slate-600">{a.operator} {a.threshold}</td>
                  <td className="font-mono text-xs font-semibold text-red-600">{a.actual_value}</td>
                  <td>
                    {a.resolved_at
                      ? <span className="badge-green">Resolved</span>
                      : <span className="badge-red">Active</span>}
                  </td>
                  <td className="text-xs text-slate-400">{new Date(a.first_alerted_at).toLocaleString()}</td>
                  <td className="text-xs text-slate-400">
                    {a.resolved_at ? new Date(a.resolved_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
