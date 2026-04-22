import { useEffect, useState, useMemo } from 'react'
import { listWorkspaces, listAllRules, listAdAccountMap, toggleRule, deleteRule, updateRule } from '../../lib/api.js'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

// ── Metric tag colors ────────────────────────────────────────────────────────
const METRIC_TAG = {
  campaign_objective:              { label: 'Objective',         cls: 'bg-purple-100 text-purple-700' },
  budget_level:                    { label: 'Budget level',      cls: 'bg-teal-100 text-teal-700' },
  budget_type:                     { label: 'Budget type',       cls: 'bg-indigo-100 text-indigo-700' },
  budget_threshold:                { label: 'Budget threshold',  cls: 'bg-blue-100 text-blue-700' },
  budget_change_frequency_monthly: { label: 'Change frequency',  cls: 'bg-amber-100 text-amber-700' },
  campaign_frequency_monthly:      { label: 'Campaign frequency', cls: 'bg-orange-100 text-orange-700' },
}

const OPERATOR_LABEL = {
  '<': 'below', '>': 'above', '=': 'exactly',
  'equals_string': 'is', 'not_equals_string': 'is not',
}

function fmtCondition(rule) {
  const op = OPERATOR_LABEL[rule.operator] || rule.operator
  let thr = rule.threshold || ''
  // budget_threshold stores "daily:5000" etc.
  if (rule.metric === 'budget_threshold' && thr.includes(':')) {
    const [mode, val] = thr.split(':')
    thr = `${mode === 'daily' ? 'daily' : 'lifetime rem.'} ${Number(val).toLocaleString()}`
  }
  return `${op} ${thr}`
}

// ── Rule Actions ─────────────────────────────────────────────────────────────
function RuleActions({ rule, onChanged }) {
  const [toggling,   setToggling]   = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [snoozeVal,  setSnoozeVal]  = useState('')

  async function handleToggle() {
    setToggling(true)
    try { await toggleRule(rule.id, !rule.active); onChanged() }
    finally { setToggling(false) }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this rule?')) return
    setDeleting(true)
    try { await deleteRule(rule.id); onChanged() }
    finally { setDeleting(false) }
  }

  async function handleSnooze() {
    if (!snoozeVal) return
    await updateRule(rule.id, { snooze_until: new Date(snoozeVal).toISOString() })
    setSnoozeOpen(false)
    setSnoozeVal('')
    onChanged()
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <button onClick={handleToggle} disabled={toggling}
          className="btn-ghost text-xs py-0.5 px-2">
          {rule.active ? 'Pause' : 'Resume'}
        </button>
        <button onClick={() => setSnoozeOpen(s => !s)}
          className="btn-ghost text-xs py-0.5 px-2">
          Snooze
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="btn-ghost text-xs py-0.5 px-2 text-red-500 hover:bg-red-50">
          Delete
        </button>
      </div>
      {snoozeOpen && (
        <div className="flex items-center gap-2 mt-1.5">
          <input type="datetime-local" value={snoozeVal}
            onChange={e => setSnoozeVal(e.target.value)}
            className="input text-xs py-1 flex-1" />
          <button onClick={handleSnooze} className="btn-primary text-xs py-1">Set</button>
        </div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function AllRules() {
  const [rules,        setRules]        = useState([])
  const [workspaces,   setWorkspaces]   = useState([])
  const [adAccountMap, setAdAccountMap] = useState({})
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [wsFilter,     setWsFilter]     = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [rules, ws, accounts] = await Promise.all([
      listAllRules(),
      listWorkspaces(),
      listAdAccountMap(),
    ])
    setRules(rules || [])
    setWorkspaces(ws || [])
    const aaMap = {}
    for (const a of (accounts || [])) aaMap[a.ad_account_id] = a.account_name
    setAdAccountMap(aaMap)
    setLoading(false)
  }

  const filtered = rules.filter(r => {
    if (wsFilter !== 'all' && String(r.workspace_id) !== wsFilter) return false
    const isSnoozed = r.snooze_until && new Date(r.snooze_until) > new Date()
    if (statusFilter === 'active'  && (!r.active || isSnoozed)) return false
    if (statusFilter === 'paused'  && r.active)                 return false
    if (statusFilter === 'snoozed' && !isSnoozed)               return false
    if (search) {
      const s = search.toLowerCase()
      return (
        r.alert_name?.toLowerCase().includes(s) ||
        r.entity_name?.toLowerCase().includes(s) ||
        r.metric?.toLowerCase().includes(s) ||
        r.workspaces?.name?.toLowerCase().includes(s) ||
        r.ad_account_id?.toLowerCase().includes(s) ||
        adAccountMap[r.ad_account_id]?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const activeCount  = rules.filter(r => r.active).length
  const pausedCount  = rules.filter(r => !r.active).length
  const snoozedCount = rules.filter(r => r.snooze_until && new Date(r.snooze_until) > new Date()).length

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">All Rules</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {activeCount} active · {pausedCount} paused · {snoozedCount} snoozed · {rules.length} total
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
        {[
          ['all',     `All (${rules.length})`],
          ['active',  `Active (${activeCount})`],
          ['paused',  `Paused (${pausedCount})`],
          ['snoozed', `Snoozed (${snoozedCount})`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`px-4 py-2 font-medium transition-colors ${
              statusFilter === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3">
        <select className="select text-sm py-1.5 w-52"
          value={wsFilter} onChange={e => setWsFilter(e.target.value)}>
          <option value="all">All workspaces</option>
          {workspaces.map(w => (
            <option key={w.id} value={String(w.id)}>{w.name}</option>
          ))}
        </select>
        <div className="relative flex-1 max-w-xs">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" size={14} />
          </div>
          <input className="input py-1.5 pl-9 text-sm" placeholder="Search rules..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <span className="text-xs text-slate-400 ml-auto">{filtered.length} rules</span>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No rules match the current filters.</div>
        ) : (
          <table className="table-base min-w-[900px]">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Ad Account</th>
                <th>Alert / Entity</th>
                <th>Rule type</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isSnoozed = r.snooze_until && new Date(r.snooze_until) > new Date()
                const tag = METRIC_TAG[r.metric] || { label: r.metric, cls: 'bg-slate-100 text-slate-600' }
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">
                        {r.workspaces?.name || r.workspace_id}
                      </span>
                    </td>
                    <td>
                      <p className="text-sm font-medium text-slate-700 whitespace-nowrap">
                        {adAccountMap[r.ad_account_id] || '—'}
                      </p>
                      <p className="text-[11px] text-slate-400">{r.ad_account_id}</p>
                    </td>
                    <td>
                      <p className="text-sm font-medium text-slate-900 truncate max-w-[200px]">{r.alert_name || '—'}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{r.entity_name || r.entity_id}</p>
                    </td>
                    <td>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${tag.cls}`}>
                        {tag.label}
                      </span>
                    </td>
                    <td className="text-xs text-slate-600 whitespace-nowrap">{fmtCondition(r)}</td>
                    <td>
                      {isSnoozed
                        ? <span className="badge-yellow">Snoozed</span>
                        : r.active
                        ? <span className="badge-green">Active</span>
                        : <span className="badge-gray">Paused</span>}
                    </td>
                    <td className="text-xs text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td>
                      <RuleActions rule={r} onChanged={load} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
