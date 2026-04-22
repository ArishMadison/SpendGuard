import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listAlerts, listRules, listCronRuns } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

function ViolationRow({ alert }) {
  const age = Math.round((Date.now() - new Date(alert.first_alerted_at)) / 3600000)
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
      <div className="w-2 h-2 bg-red-500 rounded-full mt-1.5 shrink-0 animate-pulse" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{alert.alert_name || alert.entity_name || alert.entity_id}</p>
        <p className="text-xs text-slate-600 mt-0.5">
          <span className="font-mono bg-red-100 text-red-700 px-1 py-0.5 rounded">{alert.metric}</span>
          {' '}is <strong>{alert.actual_value}</strong> — rule: {alert.operator} {alert.threshold}
        </p>
      </div>
      <p className="text-xs text-slate-400 shrink-0">{age}h ago</p>
    </div>
  )
}

export default function WorkspaceDashboard() {
  const { profile } = useAuth()
  const wsId = profile?.workspace_id

  const [violations, setViolations] = useState([])
  const [rules,      setRules]      = useState([])
  const [lastRun,    setLastRun]    = useState(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    if (!wsId) return
    load()
  }, [wsId])

  async function load() {
    setLoading(true)
    try {
      const [vl, rl, runs] = await Promise.all([
        listAlerts(wsId, { activeOnly: true }),
        listRules(wsId),
        listCronRuns(1),
      ])
      setViolations(vl)
      setRules(rl)
      setLastRun(runs[0] || null)
    } finally {
      setLoading(false)
    }
  }

  const activeRules   = rules.filter(r => r.active)
  const snoozedRules  = rules.filter(r => r.snooze_until && new Date(r.snooze_until) > new Date())
  const pausedRules   = rules.filter(r => !r.active)

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {lastRun
            ? <>Last checked {new Date(lastRun.started_at).toLocaleString()}</>
            : 'No cron run yet'}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active alerts</p>
          <p className={`text-3xl font-bold ${violations.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{violations.length}</p>
          <p className="text-xs text-slate-400">{violations.length === 0 ? 'All rules passing' : 'Needs attention'}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active rules</p>
          <p className="text-3xl font-bold text-slate-900">{activeRules.length}</p>
          <p className="text-xs text-slate-400">{rules.length} total</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Snoozed</p>
          <p className="text-3xl font-bold text-slate-900">{snoozedRules.length}</p>
          <p className="text-xs text-slate-400">{pausedRules.length} paused</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Last cron</p>
          <p className={`text-3xl font-bold ${lastRun?.status === 'completed' ? 'text-emerald-600' : lastRun?.status === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>
            {lastRun ? (lastRun.status === 'completed' ? 'OK' : lastRun.status) : '—'}
          </p>
          <p className="text-xs text-slate-400">
            {lastRun ? `${lastRun.rules_evaluated} rules evaluated` : 'Never'}
          </p>
        </div>
      </div>

      {/* Active violations */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Active violations</h2>
            {violations.length > 0 && (
              <span className="badge-red">{violations.length}</span>
            )}
          </div>
          <Link to="/workspace/activity" className="text-xs text-brand-600 hover:underline font-medium">View all alerts</Link>
        </div>

        {violations.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon d="M20 6 9 17l-5-5" size={18} />
            </div>
            <p className="text-sm font-medium text-slate-700">All rules passing</p>
            <p className="text-xs text-slate-400 mt-1">No violations detected in the last check</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {violations.map(v => <ViolationRow key={v.id} alert={v} />)}
          </div>
        )}
      </div>

      {/* Rule health */}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Rule status</h2>
          <Link to="/workspace/rules" className="text-xs text-brand-600 hover:underline font-medium">Manage rules</Link>
        </div>
        {rules.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-slate-500">No rules configured yet.</p>
            <Link to="/workspace/rules" className="btn-primary mt-3 text-xs inline-flex">Add first rule</Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rules.slice(0, 6).map(r => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{r.alert_name || r.entity_name || r.entity_id}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span className="font-mono">{r.metric}</span> {r.operator} {r.threshold}
                  </p>
                </div>
                <div className="ml-4 shrink-0">
                  {r.snooze_until && new Date(r.snooze_until) > new Date()
                    ? <span className="badge-yellow">Snoozed</span>
                    : r.active
                    ? <span className="badge-green">Active</span>
                    : <span className="badge-gray">Paused</span>
                  }
                </div>
              </div>
            ))}
            {rules.length > 6 && (
              <div className="px-5 py-3">
                <Link to="/workspace/rules" className="text-xs text-brand-600 hover:underline">+{rules.length - 6} more rules</Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
