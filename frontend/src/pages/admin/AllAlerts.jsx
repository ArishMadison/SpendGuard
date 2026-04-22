import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export default function AllAlerts() {
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('active')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('alert_log')
      .select('*, workspaces(name)')
      .order('first_alerted_at', { ascending: false })
      .limit(200)
    if (!error) setAlerts(data || [])
    setLoading(false)
  }

  const filtered = alerts.filter(a => {
    if (filter === 'active')   return !a.resolved_at
    if (filter === 'resolved') return !!a.resolved_at
    return true
  })

  function fmt(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">All Alerts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {alerts.filter(a => !a.resolved_at).length} active violations across all workspaces
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
        {['all', 'active', 'resolved'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}>
            {f}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            {filter === 'active' ? 'No active violations.' : 'No alerts found.'}
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Entity</th>
                <th>Metric</th>
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
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      {a.workspaces?.name || a.workspace_id}
                    </span>
                  </td>
                  <td>
                    <p className="font-medium text-slate-900 truncate max-w-xs">{a.entity_name || a.entity_id}</p>
                  </td>
                  <td><span className="badge-blue">{a.metric}</span></td>
                  <td className="font-mono text-xs">
                    <span className="text-red-600">{a.actual_value}</span>
                    <span className="text-slate-400 ml-1">({a.operator} {a.threshold})</span>
                  </td>
                  <td>
                    {a.resolved_at
                      ? <span className="badge-green">Resolved</span>
                      : <span className="badge-red">Active</span>}
                  </td>
                  <td className="text-xs text-slate-400 whitespace-nowrap">{fmt(a.first_alerted_at)}</td>
                  <td className="text-xs text-slate-400 whitespace-nowrap">{fmt(a.resolved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
