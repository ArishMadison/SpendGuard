import { useEffect, useState, useMemo } from 'react'
import { listAllAuditLog, listAllInvitations, listCronRuns, listWorkspaces, listUserProfiles } from '../../lib/api.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function duration(start, end) {
  if (!start || !end) return '—'
  const s = Math.round((new Date(end) - new Date(start)) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── action badge colours ───────────────────────────────────────────────────────

const ACTION_BADGE = {
  created:  'badge-green',
  updated:  'badge-blue',
  deleted:  'badge-red',
  toggled:  'badge-yellow',
  snoozed:  'badge-yellow',
  invited:  'badge-blue',
  accepted: 'badge-green',
  revoked:  'badge-red',
}

const CRON_STATUS_BADGE = {
  completed: 'badge-green',
  running:   'badge-yellow',
  failed:    'badge-red',
}

// ── ErrorsCell for cron tab ───────────────────────────────────────────────────

function ErrorsCell({ errors }) {
  const [open, setOpen] = useState(false)
  if (!errors || !Array.isArray(errors) || errors.length === 0) {
    return <span className="text-slate-300 text-xs">—</span>
  }
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="badge-red cursor-pointer hover:opacity-80 transition-opacity">
        {errors.length} error{errors.length > 1 ? 's' : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-1 max-w-sm">
          {errors.map((e, i) => (
            <div key={i} className="text-xs bg-red-50 border border-red-100 rounded px-2 py-1.5 text-red-700 font-mono break-all">
              {typeof e === 'string' ? e : e.message || e.error || JSON.stringify(e)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── DiffCell: show what changed (human-readable) ─────────────────────────────

const HIDDEN_FIELDS = new Set([
  'id', 'workspace_id', 'entity_id', 'ad_account_id',
  'created_by', 'updated_by', 'created_at', 'updated_at', 'entity_type',
])

const FIELD_LABELS = {
  alert_name: 'Alert name',
  metric: 'Metric',
  operator: 'Operator',
  threshold: 'Threshold',
  active: 'Status',
  snooze_until: 'Snoozed until',
  entity_name: 'Entity',
}

const METRIC_LABELS = {
  budget_threshold: 'Budget threshold',
  campaign_frequency_monthly: 'Campaign frequency',
  budget_change_frequency_monthly: 'Budget change frequency',
  campaign_objective: 'Campaign objective',
  budget_level: 'Budget level',
  budget_type: 'Budget type',
}

function fmtVal(key, val) {
  if (val == null || val === '') return '—'
  if (key === 'active') return val ? 'Active' : 'Paused'
  if (key === 'metric') return METRIC_LABELS[val] || val
  if (key === 'operator') {
    const map = { '<': 'below', '>': 'above', '=': 'exactly', 'equals_string': 'is', 'not_equals_string': 'is not' }
    return map[val] || val
  }
  if (key === 'threshold' && typeof val === 'string' && val.includes(':')) {
    const [mode, amount] = val.split(':')
    return `${mode === 'daily' ? 'Daily' : 'Lifetime remaining'}: ${Number(amount).toLocaleString()}`
  }
  if (key === 'snooze_until') return val ? new Date(val).toLocaleString() : 'None'
  return String(val)
}

function DiffCell({ prev, next, action }) {
  if (action === 'invited' || action === 'accepted' || action === 'revoked') return null
  if (!prev && !next) return <span className="text-slate-300 text-xs">—</span>

  // For 'created': show a summary of the new rule
  if (action === 'created' && next) {
    return (
      <div className="text-xs text-emerald-600 space-y-0.5">
        {next.entity_name && <p>Entity: {next.entity_name}</p>}
        {next.metric && <p>{fmtVal('metric', next.metric)}: {fmtVal('operator', next.operator)} {fmtVal('threshold', next.threshold)}</p>}
      </div>
    )
  }

  // For 'deleted': show what was removed
  if (action === 'deleted' && prev) {
    return (
      <div className="text-xs text-red-500 space-y-0.5">
        {prev.entity_name && <p>Entity: {prev.entity_name}</p>}
        {prev.metric && <p>{fmtVal('metric', prev.metric)}: {fmtVal('operator', prev.operator)} {fmtVal('threshold', prev.threshold)}</p>}
      </div>
    )
  }

  // For updates/toggles/snoozes: show only changed fields
  const allKeys = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])]
  const changed = allKeys.filter(k =>
    !HIDDEN_FIELDS.has(k) && JSON.stringify(prev?.[k]) !== JSON.stringify(next?.[k])
  )

  if (changed.length === 0) return <span className="text-slate-300 text-xs">—</span>

  return (
    <div className="space-y-0.5">
      {changed.map(k => (
        <div key={k} className="text-xs">
          <span className="text-slate-500">{FIELD_LABELS[k] || k}: </span>
          {prev?.[k] !== undefined && (
            <span className="text-red-500 line-through mr-1">{fmtVal(k, prev[k])}</span>
          )}
          {next?.[k] !== undefined && (
            <span className="text-emerald-600">{fmtVal(k, next[k])}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function AdminActivity() {
  const [tab,        setTab]        = useState('audit')
  const [auditLog,   setAuditLog]   = useState([])
  const [invites,    setInvites]    = useState([])
  const [cronRuns,   setCronRuns]   = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [loading,    setLoading]    = useState(true)

  // filters
  const [wsFilter,     setWsFilter]     = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [sortAsc,      setSortAsc]      = useState(false)

  // Map of user UUID → { email, role }
  const [userMap, setUserMap] = useState({})

  useEffect(() => {
    setLoading(true)
    Promise.all([
      listAllAuditLog(300),
      listAllInvitations(200),
      listCronRuns(50),
      listWorkspaces(),
      listUserProfiles(),
    ]).then(([audit, inv, cron, ws, profiles]) => {
      setAuditLog(audit || [])
      setInvites(inv   || [])
      setCronRuns(cron || [])
      setWorkspaces(ws || [])

      // Build user lookup: UUID → { email, role, workspace }
      const uMap = {}
      // Map workspace_id → accepted invite email
      const wsEmailMap = {}
      for (const i of (inv || [])) {
        if (i.accepted_at) wsEmailMap[i.workspace_id] = i.email
      }
      const wsNameMap = Object.fromEntries((ws || []).map(w => [w.id, w.name]))
      for (const p of profiles) {
        uMap[p.id] = {
          role: p.role,
          email: wsEmailMap[p.workspace_id] || null,
          workspace: wsNameMap[p.workspace_id] || null,
        }
      }
      setUserMap(uMap)
    }).finally(() => setLoading(false))
  }, [])

  // Merge audit log entries + invite events into one unified timeline
  const unified = useMemo(() => {
    const auditEntries = auditLog.map(e => ({
      id:        `audit-${e.id}`,
      ts:        e.changed_at,
      workspace: e.workspaces?.name || `WS #${e.workspace_id}`,
      wsId:      e.workspace_id,
      action:    e.action,
      subject:   e.new_value?.alert_name || e.previous_value?.alert_name || e.new_value?.entity_name || e.previous_value?.entity_name || '—',
      detail:    e.new_value?.metric
                   ? `${METRIC_LABELS[e.new_value.metric] || e.new_value.metric}`
                   : e.previous_value?.metric
                   ? `${METRIC_LABELS[e.previous_value.metric] || e.previous_value.metric}`
                   : '—',
      prev:      e.previous_value,
      next:      e.new_value,
      by:        e.changed_by
                   ? (userMap[e.changed_by]?.role === 'super_admin'
                       ? 'Admin'
                       : userMap[e.changed_by]?.email || userMap[e.changed_by]?.workspace || e.changed_by.slice(0, 8) + '…')
                   : '—',
      byRole:    e.changed_by ? (userMap[e.changed_by]?.role || null) : null,
    }))

    const inviteEntries = invites.flatMap(inv => {
      const entries = [{
        id:        `invite-${inv.id}`,
        ts:        inv.sent_at,
        workspace: inv.workspaces?.name || `WS #${inv.workspace_id}`,
        wsId:      inv.workspace_id,
        action:    'invited',
        subject:   inv.email,
        detail:    'Invite sent',
        prev:      null,
        next:      null,
        by:        'super admin',
      }]
      if (inv.accepted_at) {
        entries.push({
          id:        `invite-accepted-${inv.id}`,
          ts:        inv.accepted_at,
          workspace: inv.workspaces?.name || `WS #${inv.workspace_id}`,
          wsId:      inv.workspace_id,
          action:    'accepted',
          subject:   inv.email,
          detail:    'Invite accepted',
          prev:      null,
          next:      null,
          by:        inv.email,
        })
      }
      if (inv.revoked) {
        entries.push({
          id:        `invite-revoked-${inv.id}`,
          ts:        inv.sent_at,
          workspace: inv.workspaces?.name || `WS #${inv.workspace_id}`,
          wsId:      inv.workspace_id,
          action:    'revoked',
          subject:   inv.email,
          detail:    'Access revoked',
          prev:      null,
          next:      null,
          by:        'super admin',
        })
      }
      return entries
    })

    return [...auditEntries, ...inviteEntries]
  }, [auditLog, invites, userMap])

  // Apply filters + sort
  const filtered = useMemo(() => {
    let rows = unified
    if (wsFilter !== 'all')     rows = rows.filter(r => String(r.wsId) === wsFilter)
    if (actionFilter !== 'all') rows = rows.filter(r => r.action === actionFilter)
    rows = [...rows].sort((a, b) => {
      const diff = new Date(a.ts) - new Date(b.ts)
      return sortAsc ? diff : -diff
    })
    return rows
  }, [unified, wsFilter, actionFilter, sortAsc])

  const allActions = ['all', ...new Set(unified.map(e => e.action))]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Activity</h1>
        <p className="text-sm text-slate-500 mt-0.5">All workspace rule changes, invites, and sync runs</p>
      </div>

      {/* Tab switcher */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
        {[['audit', 'Audit Log'], ['cron', 'Sync Runs']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 font-medium transition-colors ${
              tab === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}>
            {label}
            {key === 'audit' && unified.length > 0 && (
              <span className="ml-1.5 text-xs opacity-60">({unified.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── AUDIT LOG TAB ─────────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Workspace filter */}
            <select className="select w-52 py-1.5 text-sm"
              value={wsFilter} onChange={e => setWsFilter(e.target.value)}>
              <option value="all">All workspaces</option>
              {workspaces.map(w => (
                <option key={w.id} value={String(w.id)}>{w.name}</option>
              ))}
            </select>

            {/* Action filter */}
            <select className="select w-44 py-1.5 text-sm"
              value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
              {allActions.map(a => (
                <option key={a} value={a}>{a === 'all' ? 'All actions' : a.charAt(0).toUpperCase() + a.slice(1)}</option>
              ))}
            </select>

            {/* Sort toggle */}
            <button onClick={() => setSortAsc(s => !s)}
              className="btn-secondary text-xs py-1.5 gap-1.5">
              {sortAsc ? '↑ Oldest first' : '↓ Newest first'}
            </button>

            <span className="text-xs text-slate-400 ml-auto">{filtered.length} events</span>
          </div>

          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">No activity yet.</div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => setSortAsc(s => !s)}>
                      Time {sortAsc ? '↑' : '↓'}
                    </th>
                    <th>Workspace</th>
                    <th>Action</th>
                    <th>Subject</th>
                    <th>Changes</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id}>
                      <td className="text-xs text-slate-500 whitespace-nowrap">{fmt(e.ts)}</td>
                      <td>
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {e.workspace}
                        </span>
                      </td>
                      <td>
                        <span className={ACTION_BADGE[e.action] || 'badge-gray'}>
                          {e.action}
                        </span>
                      </td>
                      <td className="max-w-xs">
                        <p className="text-sm text-slate-800 truncate">{e.subject}</p>
                        <p className="text-xs text-slate-400 truncate">{e.detail}</p>
                      </td>
                      <td className="max-w-xs">
                        <DiffCell prev={e.prev} next={e.next} action={e.action} />
                      </td>
                      <td className="text-xs">
                        <span className="text-slate-700">{e.by}</span>
                        {e.byRole && (
                          <span className={`ml-1.5 ${e.byRole === 'super_admin' ? 'badge-blue' : 'badge-gray'}`}>
                            {e.byRole === 'super_admin' ? 'admin' : 'user'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── CRON RUNS TAB ─────────────────────────────────────────────────── */}
      {tab === 'cron' && (
        <>
          {cronRuns.length > 0 && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total syncs',     value: cronRuns.length },
                { label: 'Last sync',       value: fmt(cronRuns[0]?.started_at) },
                { label: 'Last violations', value: cronRuns[0]?.violations_found ?? '—' },
                { label: 'Emails sent',     value: cronRuns.reduce((s, r) => s + (r.emails_sent || 0), 0) },
              ].map(({ label, value }) => (
                <div key={label} className="stat-card">
                  <p className="text-xs text-slate-500 font-medium">{label}</p>
                  <p className="text-xl font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="card overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
            ) : cronRuns.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">No cron runs recorded yet.</div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Workspaces</th>
                    <th>Rules evaluated</th>
                    <th>Violations</th>
                    <th>New alerts</th>
                    <th>Emails sent</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {cronRuns.map(r => (
                    <tr key={r.id}>
                      <td className="text-xs text-slate-600 whitespace-nowrap">{fmt(r.started_at)}</td>
                      <td className="text-xs text-slate-500">{duration(r.started_at, r.finished_at)}</td>
                      <td><span className={CRON_STATUS_BADGE[r.status] || 'badge-gray'}>{r.status}</span></td>
                      <td className="text-sm text-slate-700">{r.workspaces_processed ?? '—'}</td>
                      <td className="text-sm text-slate-700">{r.rules_evaluated ?? '—'}</td>
                      <td className="text-sm text-slate-700">{r.violations_found ?? '—'}</td>
                      <td className="text-sm text-slate-700">{r.new_violations ?? '—'}</td>
                      <td className="text-sm text-slate-700">{r.emails_sent ?? '—'}</td>
                      <td><ErrorsCell errors={r.errors} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
