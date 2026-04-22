import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listWorkspaces, createWorkspace, listCronRuns } from '../../lib/api.js'
import { supabase } from '../../lib/supabase.js'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const ACTION_BADGE = {
  created:  'badge-green',
  updated:  'badge-blue',
  deleted:  'badge-red',
  toggled:  'badge-yellow',
  snoozed:  'badge-yellow',
}

export default function AdminDashboard() {
  const navigate = useNavigate()

  const [workspaces, setWorkspaces] = useState([])
  const [syncRuns,   setSyncRuns]   = useState([])
  const [alerts,     setAlerts]     = useState([])
  const [activity,   setActivity]   = useState([])
  const [ruleCount,  setRuleCount]  = useState(0)
  const [campaigns,  setCampaigns]  = useState([])   // entity_cache rows (campaigns only)
  const [allRules,   setAllRules]   = useState([])   // all validation_rules
  const [loading,    setLoading]    = useState(true)
  const [showModal,  setShowModal]  = useState(false)
  const [form,       setForm]       = useState({ name: '' })
  const [creating,   setCreating]   = useState(false)
  const [createErr,  setCreateErr]  = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [ws, runs, al, audit, rc, camps, rules] = await Promise.all([
        listWorkspaces(),
        listCronRuns(5),
        supabase
          .from('alert_log')
          .select('id, workspace_id, entity_name, entity_id, metric, operator, threshold, actual_value, first_alerted_at, workspaces(name)')
          .is('resolved_at', null)
          .order('first_alerted_at', { ascending: false })
          .then(r => r.data || []),
        supabase
          .from('rule_audit_log')
          .select('id, workspace_id, action, changed_at, new_value, previous_value, workspaces(name)')
          .order('changed_at', { ascending: false })
          .limit(8)
          .then(r => r.data || []),
        supabase
          .from('validation_rules')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .then(r => r.count || 0),
        supabase
          .from('entity_cache')
          .select('entity_id, entity_type, workspace_id, ad_account_id, name, objective, daily_budget, lifetime_budget, budget_type, status, last_synced_at')
          .eq('entity_type', 'campaign')
          .order('name')
          .then(r => r.data || []),
        supabase
          .from('validation_rules')
          .select('id, entity_id, workspace_id, active, alert_name, metric, operator, threshold, snooze_until')
          .then(r => r.data || []),
      ])
      setWorkspaces(ws)
      setSyncRuns(runs)
      setAlerts(al)
      setActivity(audit)
      setRuleCount(rc)
      setCampaigns(camps)
      setAllRules(rules)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateErr(null)
    setCreating(true)
    try {
      const ws = await createWorkspace(form)
      setShowModal(false)
      setForm({ name: '' })
      navigate(`/admin/workspaces/${ws.id}`)
    } catch (err) { setCreateErr(err.message) }
    finally { setCreating(false) }
  }

  const activeWs   = workspaces.filter(w => w.is_active).length
  const assignedWs = workspaces.filter(w => w.user_id).length
  const lastSync   = syncRuns[0]

  // Per-entity aggregates (arrays for tooltip details)
  const rulesByEntity = useMemo(() => {
    const m = {}
    for (const r of allRules) {
      if (!m[r.entity_id]) m[r.entity_id] = []
      m[r.entity_id].push(r)
    }
    return m
  }, [allRules])

  const alertsByEntity = useMemo(() => {
    const m = {}
    for (const a of alerts) {
      if (!m[a.entity_id]) m[a.entity_id] = []
      m[a.entity_id].push(a)
    }
    return m
  }, [alerts])

  // Workspace lookup map
  const wsMap = useMemo(() => Object.fromEntries(workspaces.map(w => [w.id, w])), [workspaces])

  // Campaigns enriched with workspace name + rule/violation details
  const enrichedCampaigns = useMemo(() => campaigns.map(c => {
    const rules = rulesByEntity[c.entity_id] || []
    const entityAlerts = alertsByEntity[c.entity_id] || []
    return {
      ...c,
      workspace:      wsMap[c.workspace_id],
      rulesList:      rules,
      rulesActive:    rules.filter(r => r.active).length,
      rulesTotal:     rules.length,
      alertsList:     entityAlerts,
      violationCount: entityAlerts.length,
    }
  }), [campaigns, wsMap, rulesByEntity, alertsByEntity])

  // Per-workspace alert counts for the violations column
  const alertsByWs = useMemo(() => {
    const m = {}
    for (const a of alerts) { m[a.workspace_id] = (m[a.workspace_id] || 0) + 1 }
    return m
  }, [alerts])

  // Hover tooltip for rules/violations details
  const [tooltip, setTooltip] = useState(null)
  function handleTooltipEnter(e, type, items) {
    if (!items || items.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({ type, items, x: rect.left, y: rect.top })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500 mt-0.5">Platform health at a glance</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <Icon d="M12 5v14M5 12h14" size={15} /> New workspace
        </button>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Workspaces</p>
          <p className="text-3xl font-bold text-slate-900">{workspaces.length}</p>
          <p className="text-xs text-slate-400">{activeWs} active · {workspaces.length - assignedWs} without user</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active rules</p>
          <p className="text-3xl font-bold text-slate-900">{ruleCount}</p>
          <p className="text-xs text-slate-400">across all workspaces</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active violations</p>
          <p className={`text-3xl font-bold ${alerts.length > 0 ? 'text-red-600' : 'text-slate-900'}`}>{alerts.length}</p>
          <p className="text-xs text-slate-400">{alerts.length > 0 ? 'need attention' : 'all clear'}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Last sync</p>
          <p className={`text-3xl font-bold ${
            lastSync?.status === 'completed' ? 'text-emerald-600'
            : lastSync?.status === 'failed'  ? 'text-red-600'
            : 'text-slate-900'
          }`}>
            {lastSync ? (lastSync.status === 'completed' ? 'OK' : lastSync.status) : '—'}
          </p>
          <p className="text-xs text-slate-400">{lastSync ? timeAgo(lastSync.started_at) : 'Never run'}</p>
        </div>
      </div>

      {/* ── Rules & Violations ──────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Rules & Violations</h2>
          <Link to="/admin/workspaces" className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1">
            Workspaces <Icon d="M9 18l6-6-6-6" size={12} />
          </Link>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : enrichedCampaigns.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-500 mb-3">No campaigns synced yet.</p>
            <button onClick={() => setShowModal(true)} className="btn-primary text-xs">Create workspace</button>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Workspace</th>
                  <th>Objective</th>
                  <th>Budget</th>
                  <th>Rules</th>
                  <th>Violations</th>
                </tr>
              </thead>
              <tbody>
                {enrichedCampaigns.slice(0, 50).map(c => (
                  <tr key={c.entity_id}
                    className="cursor-pointer"
                    onClick={() => c.workspace && navigate(`/admin/workspaces/${c.workspace_id}`)}>
                    <td className="max-w-xs">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.ad_account_id}</p>
                    </td>
                    <td>
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {c.workspace?.name || `WS ${c.workspace_id}`}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">{c.objective || '—'}</td>
                    <td className="text-sm text-slate-700 whitespace-nowrap">
                      {c.daily_budget != null
                        ? `${Number(c.daily_budget).toLocaleString()} / day`
                        : c.lifetime_budget != null
                        ? `${Number(c.lifetime_budget).toLocaleString()} lifetime`
                        : '—'}
                    </td>
                    <td>
                      {c.rulesTotal > 0
                        ? <span className="text-xs text-slate-600 cursor-default"
                            onMouseEnter={e => { e.stopPropagation(); handleTooltipEnter(e, 'rules', c.rulesList) }}
                            onMouseLeave={() => setTooltip(null)}
                            onClick={e => e.stopPropagation()}>
                            <span className="font-semibold">{c.rulesActive}</span>
                            <span className="text-slate-400"> / {c.rulesTotal}</span>
                          </span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td>
                      {c.violationCount > 0
                        ? <span className="badge-red cursor-default"
                            onMouseEnter={e => { e.stopPropagation(); handleTooltipEnter(e, 'violations', c.alertsList) }}
                            onMouseLeave={() => setTooltip(null)}
                            onClick={e => e.stopPropagation()}>
                            {c.violationCount}
                          </span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Lower grid: activity + sync runs ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Recent activity */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
            <Link to="/admin/activity" className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1">
              View all <Icon d="M9 18l6-6-6-6" size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-400">Loading...</div>
          ) : activity.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No activity yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activity.map(e => (
                <div key={e.id} className="px-5 py-3 flex items-start gap-3">
                  <span className={`${ACTION_BADGE[e.action] || 'badge-gray'} mt-0.5 shrink-0`}>{e.action}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-800 truncate">
                      <span className="font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] mr-1.5">
                        {e.workspaces?.name || `WS ${e.workspace_id}`}
                      </span>
                      {e.new_value?.alert_name || e.previous_value?.alert_name || e.new_value?.metric || 'rule'}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">{timeAgo(e.changed_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sync runs */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Recent syncs</h2>
            <Link to="/admin/activity" state={{ tab: 'sync' }} className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1">
              View all <Icon d="M9 18l6-6-6-6" size={12} />
            </Link>
          </div>
          {syncRuns.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No syncs recorded yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {syncRuns.map(run => (
                <div key={run.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-600">{new Date(run.started_at).toLocaleString()}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {run.rules_evaluated ?? 0} rules · {run.violations_found ?? 0} violations · {run.emails_sent ?? 0} emails
                    </p>
                  </div>
                  <span className={{
                    completed: 'badge-green',
                    running:   'badge-yellow',
                    failed:    'badge-red',
                  }[run.status] || 'badge-gray'}>{run.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Hover tooltip for rules / violations */}
      {tooltip && (
        <div
          className="fixed z-[100] bg-white border border-slate-200 rounded-lg shadow-lg p-3 min-w-56 max-w-72"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translateY(-100%)' }}
          onMouseLeave={() => setTooltip(null)}>
          {tooltip.type === 'rules' && (() => {
            const MTAG = {
              campaign_objective: 'bg-purple-100 text-purple-700',
              budget_level: 'bg-teal-100 text-teal-700',
              budget_type: 'bg-indigo-100 text-indigo-700',
              budget_threshold: 'bg-blue-100 text-blue-700',
              budget_change_frequency_monthly: 'bg-amber-100 text-amber-700',
            }
            return (
              <>
                <p className="text-[11px] font-semibold text-slate-700 mb-1.5">Rules ({tooltip.items.length})</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {tooltip.items.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-700 truncate">{r.alert_name || r.metric}</p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${MTAG[r.metric] || 'bg-slate-100 text-slate-600'}`}>
                          {r.metric?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className={`text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded-full ${
                        r.snooze_until && new Date(r.snooze_until) > new Date() ? 'bg-amber-100 text-amber-600'
                        : r.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {r.snooze_until && new Date(r.snooze_until) > new Date() ? 'Snoozed'
                         : r.active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}
          {tooltip.type === 'violations' && (
            <>
              <p className="text-[11px] font-semibold text-red-600 mb-1.5">Violations ({tooltip.items.length})</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {tooltip.items.map(v => (
                  <div key={v.id}>
                    <p className="text-xs text-slate-700 truncate">{v.entity_name || v.entity_id}</p>
                    <p className="text-[10px] text-red-500">
                      {v.metric} {v.operator} {v.threshold} · got <span className="font-semibold">{v.actual_value}</span>
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Create workspace modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">New workspace</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <Icon d="M18 6 6 18M6 6l12 12" size={18} />
              </button>
            </div>
            {createErr && <p className="text-sm text-red-600 mb-4">{createErr}</p>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Workspace name</label>
                <input className="input" placeholder="e.g. Acme Corp - Search"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={creating} className="btn-primary flex-1 justify-center">
                  {creating ? 'Creating...' : 'Create workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
