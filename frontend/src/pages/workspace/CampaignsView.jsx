import { useEffect, useState, useMemo } from 'react'
import { listCampaignsView, listAdAccounts, createRule, updateRule, deleteRule, toggleRule, refreshEntityCache } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const METRICS = [
  { value: 'campaign_objective',              label: "Campaign objective",        desc: "Alert when the campaign's objective is or isn't a specific type.", kind: 'string' },
  { value: 'budget_level',                    label: 'Budget level',              desc: "Alert when budget is set at campaign level (CBO) or adset level (ABO).", kind: 'string' },
  { value: 'budget_type',                     label: 'Budget type',               desc: "Alert when budget is daily or lifetime.", kind: 'string' },
  { value: 'budget_threshold',                label: 'Budget threshold',          desc: "Alert when remaining daily or lifetime budget crosses a value.", kind: 'numeric' },
  { value: 'budget_change_frequency_monthly', label: 'Budget change frequency',   desc: "Alert when budget has been changed more than N times this month.", kind: 'numeric' },
]

const OBJECTIVES = [
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS',
  'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION',
]

const OPERATOR_LABELS = { '<': 'below', '>': 'above', '=': 'exactly' }
const STRING_OPERATOR_LABELS = { equals_string: 'is', not_equals_string: 'is not' }

function fmt(n, currency = '') {
  if (n == null) return '—'
  return currency
    ? `${currency} ${Number(n).toLocaleString()}`
    : Number(n).toLocaleString()
}

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Inline rules panel ────────────────────────────────────────────────────────
function RulesPanel({ entity, onChanged, onClose }) {
  const [toggling,   setToggling]   = useState({})
  const [deleting,   setDeleting]   = useState({})
  const [snoozeOpen, setSnoozeOpen] = useState(null)
  const [snoozeVal,  setSnoozeVal]  = useState('')

  const rules = entity.rules || []

  async function handleToggle(rule) {
    setToggling(p => ({ ...p, [rule.id]: true }))
    try { await toggleRule(rule.id, !rule.active); onChanged() }
    finally { setToggling(p => ({ ...p, [rule.id]: false })) }
  }

  async function handleDelete(rule) {
    if (!window.confirm('Delete this rule?')) return
    setDeleting(p => ({ ...p, [rule.id]: true }))
    try { await deleteRule(rule.id); onChanged() }
    finally { setDeleting(p => ({ ...p, [rule.id]: false })) }
  }

  async function handleSnooze(rule) {
    if (!snoozeVal) return
    await updateRule(rule.id, { snooze_until: new Date(snoozeVal).toISOString() })
    setSnoozeOpen(null)
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="card w-full max-w-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Rules</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{entity.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icon d="M18 6 6 18M6 6l12 12" size={18} />
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">No rules set on this entity.</p>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => {
              const isSnoozed = rule.snooze_until && new Date(rule.snooze_until) > new Date()
              return (
                <div key={rule.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{rule.alert_name || '—'}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${({
                          campaign_objective: 'bg-purple-100 text-purple-700',
                          budget_level: 'bg-teal-100 text-teal-700',
                          budget_type: 'bg-indigo-100 text-indigo-700',
                          budget_threshold: 'bg-blue-100 text-blue-700',
                          budget_change_frequency_monthly: 'bg-amber-100 text-amber-700',
                        })[rule.metric] || 'bg-slate-100 text-slate-600'}`}>
                          {rule.metric?.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-slate-400">{rule.operator} {rule.threshold}</span>
                      </div>
                    </div>
                    {isSnoozed
                      ? <span className="badge-yellow shrink-0">Snoozed</span>
                      : rule.active
                      ? <span className="badge-green shrink-0">Active</span>
                      : <span className="badge-gray shrink-0">Paused</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button onClick={() => handleToggle(rule)} disabled={toggling[rule.id]}
                      className="btn-ghost text-xs py-0.5 px-2">
                      {rule.active ? 'Pause' : 'Resume'}
                    </button>
                    <button onClick={() => setSnoozeOpen(snoozeOpen === rule.id ? null : rule.id)}
                      className="btn-ghost text-xs py-0.5 px-2">
                      Snooze
                    </button>
                    <button onClick={() => handleDelete(rule)} disabled={deleting[rule.id]}
                      className="btn-ghost text-xs py-0.5 px-2 text-red-500 hover:bg-red-50">
                      Delete
                    </button>
                  </div>
                  {snoozeOpen === rule.id && (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="datetime-local" value={snoozeVal}
                        onChange={e => setSnoozeVal(e.target.value)}
                        className="input text-xs py-1 flex-1" />
                      <button onClick={() => handleSnooze(rule)} className="btn-primary text-xs py-1">Set</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add Rule modal ────────────────────────────────────────────────────────────
function AddRuleModal({ entity, wsId, adAccounts, onClose, onSaved }) {
  const defaultForm = {
    alert_name: '', metric: 'budget_threshold', operator: '>',
    threshold: '', budget_mode: 'daily',
  }
  const [form,      setForm]      = useState(defaultForm)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState(null)

  const metricDef             = METRICS.find(m => m.value === form.metric)
  const isStringMetric        = metricDef?.kind === 'string'
  const isBudgetThreshold     = form.metric === 'budget_threshold'
  const isBudgetChange        = form.metric === 'budget_change_frequency_monthly'

  const showCBOWarning = isBudgetThreshold && entity.entity_type === 'adset' && entity.campaign_budget_opt

  // Auto-set operator for string metrics
  function handleMetricChange(metric) {
    const def = METRICS.find(m => m.value === metric)
    setForm({
      ...defaultForm,
      alert_name: form.alert_name,
      metric,
      operator: def?.kind === 'string' ? 'equals_string' : '>',
      threshold: '',
    })
  }

  async function handleSave(e) {
    e.preventDefault()
    if (showCBOWarning) { setSaveError('This adset is under CBO — set the rule on the campaign instead.'); return }
    setSaveError(null)
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const threshold = isBudgetThreshold ? `${form.budget_mode}:${form.threshold}` : form.threshold
      await createRule({
        workspace_id:  wsId,
        ad_account_id: entity.ad_account_id,
        entity_type:   entity.entity_type,
        entity_id:     entity.entity_id,
        entity_name:   entity.name,
        metric:        form.metric,
        operator:      form.operator,
        threshold,
        alert_name:    form.alert_name,
        created_by:    user.id,
        updated_by:    user.id,
      })
      onSaved()
    } catch (err) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  const canSave = form.threshold && !showCBOWarning

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="card w-full max-w-md p-6 my-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add rule</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
              <span className="capitalize">{entity.entity_type}</span> · {entity.name}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icon d="M18 6 6 18M6 6l12 12" size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Alert name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Alert name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input className="input" placeholder="e.g. Wrong objective check"
              value={form.alert_name} onChange={e => setForm(p => ({ ...p, alert_name: e.target.value }))} />
          </div>

          {/* Rule type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Rule type</label>
            <select className="select" value={form.metric} onChange={e => handleMetricChange(e.target.value)}>
              {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className="text-xs text-slate-500 mt-1">{metricDef?.desc}</p>
          </div>

          {/* CBO warning */}
          {showCBOWarning && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              This adset is under Campaign Budget Optimisation — budget is controlled at the campaign level. Set this rule on the campaign instead.
            </div>
          )}

          {/* ── String metric: campaign_objective ─────────────────────── */}
          {form.metric === 'campaign_objective' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <p className="text-sm font-medium text-slate-700">Alert me when objective</p>
              <div className="flex gap-3">
                <select className="select w-28" value={form.operator}
                  onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}>
                  <option value="equals_string">is</option>
                  <option value="not_equals_string">is not</option>
                </select>
                <select className="select flex-1" value={form.threshold}
                  onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} required>
                  <option value="">— select objective —</option>
                  {OBJECTIVES.map(o => <option key={o} value={o}>{o.replace('OUTCOME_', '').replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── String metric: budget_level ───────────────────────────── */}
          {form.metric === 'budget_level' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <p className="text-sm font-medium text-slate-700">Alert me when budget is at</p>
              <div className="flex gap-3 items-center">
                <select className="select w-28" value={form.operator}
                  onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}>
                  <option value="equals_string">is</option>
                  <option value="not_equals_string">is not</option>
                </select>
                <div className="flex gap-3 flex-1">
                  {[['campaign', 'Campaign level (CBO)'], ['adset', 'Adset level (ABO)']].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="budget_level" value={v}
                        checked={form.threshold === v}
                        onChange={() => setForm(p => ({ ...p, threshold: v }))}
                        className="accent-slate-900" />
                      <span className="text-sm text-slate-700">{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── String metric: budget_type ────────────────────────────── */}
          {form.metric === 'budget_type' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <p className="text-sm font-medium text-slate-700">Alert me when budget type</p>
              <div className="flex gap-3 items-center">
                <select className="select w-28" value={form.operator}
                  onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}>
                  <option value="equals_string">is</option>
                  <option value="not_equals_string">is not</option>
                </select>
                <div className="flex gap-3 flex-1">
                  {[['daily', 'Daily'], ['lifetime', 'Lifetime']].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="budget_type_val" value={v}
                        checked={form.threshold === v}
                        onChange={() => setForm(p => ({ ...p, threshold: v }))}
                        className="accent-slate-900" />
                      <span className="text-sm text-slate-700">{l}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Numeric: budget_threshold ─────────────────────────────── */}
          {isBudgetThreshold && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <p className="text-sm font-medium text-slate-700">Alert me when budget is</p>
              <div className="flex gap-3 mb-2">
                {[['daily', 'Daily budget'], ['lifetime_remaining', 'Lifetime remaining']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="budget_mode" value={v} checked={form.budget_mode === v}
                      onChange={() => setForm(p => ({ ...p, budget_mode: v }))} className="accent-slate-900" />
                    <span className="text-sm text-slate-700">{l}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <select className="select w-28" value={form.operator}
                  onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}>
                  {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                    <option key={op} value={op}>{label}</option>
                  ))}
                </select>
                <input type="number" step="0.01" min="0" className="input flex-1"
                  value={form.threshold} placeholder="e.g. 5000 (in account currency)"
                  onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} required />
              </div>
            </div>
          )}

          {/* ── Numeric: budget_change_frequency ──────────────────────── */}
          {isBudgetChange && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <p className="text-sm font-medium text-slate-700">Alert me when budget changes this month are</p>
              <div className="flex gap-3">
                <select className="select w-28" value={form.operator}
                  onChange={e => setForm(p => ({ ...p, operator: e.target.value }))}>
                  {Object.entries(OPERATOR_LABELS).map(([op, label]) => (
                    <option key={op} value={op}>{label}</option>
                  ))}
                </select>
                <input type="number" step="1" min="0" className="input flex-1"
                  value={form.threshold} placeholder="e.g. 5"
                  onChange={e => setForm(p => ({ ...p, threshold: e.target.value }))} required />
              </div>
            </div>
          )}

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={saving || !canSave}
              className="btn-primary flex-1 justify-center">
              {saving ? 'Saving...' : 'Save rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Entity row ────────────────────────────────────────────────────────────────
function EntityRow({ entity, isAdset, wsId, adAccounts, onAddRule, onViewRules }) {
  const budget = entity.daily_budget ?? entity.lifetime_budget
  const budgetLabel = entity.campaign_budget_opt && entity.entity_type === 'adset'
    ? 'via campaign'
    : budget != null
      ? `${fmt(budget)} / ${entity.budget_type === 'daily' ? 'day' : 'lifetime'}`
      : '—'

  const activeRules = (entity.rules || []).filter(r => r.active).length
  const totalRules  = (entity.rules || []).length

  return (
    <tr className={isAdset ? 'bg-slate-50/60' : ''}>
      <td className="max-w-xs">
        <div className={`flex items-center gap-2 ${isAdset ? 'pl-6' : ''}`}>
          {isAdset && <span className="text-slate-300 text-xs shrink-0">└</span>}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{entity.name}</p>
            <p className="text-xs text-slate-400">{entity.entity_type}</p>
          </div>
        </div>
      </td>
      <td className="text-xs text-slate-500">{entity.objective || '—'}</td>
      <td className="text-sm text-slate-700 whitespace-nowrap">{budgetLabel}</td>
      <td className="text-xs text-slate-500">
        {entity.budget_change_count > 0
          ? <span className="badge-yellow">{entity.budget_change_count}×</span>
          : <span className="text-slate-300">—</span>}
      </td>
      <td>
        {totalRules > 0
          ? (
            <button onClick={() => onViewRules(entity)}
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
              <span className="font-semibold">{activeRules}</span>
              <span className="text-slate-400">/ {totalRules}</span>
            </button>
          )
          : <span className="text-slate-300 text-xs">—</span>
        }
      </td>
      <td>
        {entity.violations > 0
          ? <span className="badge-red">{entity.violations}</span>
          : <span className="text-slate-300 text-xs">—</span>}
      </td>
      <td>
        <button onClick={() => onAddRule(entity)}
          className="btn-ghost text-xs py-1 px-2 whitespace-nowrap">
          + Rule
        </button>
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CampaignsView({ workspaceId: propWorkspaceId, embedded = false } = {}) {
  const { profile } = useAuth()
  const wsId = propWorkspaceId ?? profile?.workspace_id

  const [entities,    setEntities]    = useState([])
  const [adAccounts,  setAdAccounts]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [selAccount,  setSelAccount]  = useState(null)
  const [expanded,    setExpanded]    = useState(new Set())
  const [addRuleFor,  setAddRuleFor]  = useState(null)  // entity obj
  const [viewRulesFor, setViewRulesFor] = useState(null) // entity obj
  const [ruleFilter,  setRuleFilter]  = useState('all')

  useEffect(() => { if (wsId) load() }, [wsId])

  async function load({ bust = false } = {}) {
    setLoading(true)
    try {
      const [data, accounts] = await Promise.all([
        listCampaignsView(wsId, { bust }),
        listAdAccounts(wsId),
      ])
      setEntities(data)
      setAdAccounts(accounts)
      if (accounts.length > 0) {
        setSelAccount(prev => prev || accounts[0].ad_account_id)
      }
    } finally { setLoading(false) }
  }

  async function handleRefresh() {
    if (!selAccount) return
    setRefreshing(true)
    try {
      await refreshEntityCache(wsId, selAccount)
      await load({ bust: true })
    } finally { setRefreshing(false) }
  }

  async function handleRuleSaved() {
    setAddRuleFor(null)
    await load({ bust: true })
  }

  async function handleRulesChanged() {
    setViewRulesFor(null)
    await load({ bust: true })
  }

  // Build campaign tree for selected account
  const { campaigns, adsetsByParent, lastSynced } = useMemo(() => {
    const forAccount = entities.filter(e => e.ad_account_id === selAccount)
    const camps = forAccount.filter(e => e.entity_type === 'campaign')
    const byParent = {}
    for (const a of forAccount.filter(e => e.entity_type === 'adset')) {
      if (!byParent[a.parent_id]) byParent[a.parent_id] = []
      byParent[a.parent_id].push(a)
    }
    const synced = forAccount[0]?.last_synced_at || null
    return { campaigns: camps, adsetsByParent: byParent, lastSynced: synced }
  }, [entities, selAccount])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Filter campaigns based on rule filter dropdown
  const filteredCampaigns = useMemo(() => {
    if (ruleFilter === 'all') return campaigns
    return campaigns.filter(c => {
      const rules = c.rules || []
      if (ruleFilter === 'with_rules')     return rules.length > 0
      if (ruleFilter === 'active_rules')   return rules.some(r => r.active)
      if (ruleFilter === 'paused_rules')   return rules.some(r => !r.active)
      if (ruleFilter === 'snoozed_rules')  return rules.some(r => r.snooze_until && new Date(r.snooze_until) > new Date())
      if (ruleFilter === 'with_violations') return c.violations > 0
      if (ruleFilter === 'no_rules')       return rules.length === 0
      return true
    })
  }, [campaigns, ruleFilter])

  const totalRules      = entities.reduce((s, e) => s + (e.rules?.length || 0), 0)
  const totalViolations = entities.reduce((s, e) => s + (e.violations || 0), 0)

  return (
    <div className={embedded ? "space-y-4" : "p-6 max-w-6xl mx-auto space-y-5"}>

      {/* Header (standalone mode only) */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Campaigns</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {totalRules} rule{totalRules !== 1 ? 's' : ''} set
              {totalViolations > 0 && <span className="text-red-500 ml-2">· {totalViolations} active violation{totalViolations !== 1 ? 's' : ''}</span>}
              {lastSynced && <span className="ml-2">· synced {timeAgo(lastSynced)}</span>}
            </p>
          </div>
          <button onClick={handleRefresh} disabled={refreshing || !selAccount}
            className="btn-secondary text-xs gap-1.5">
            <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={13} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Filter controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select className="select text-sm py-1.5 w-44" value={ruleFilter}
            onChange={e => setRuleFilter(e.target.value)}>
            <option value="all">All campaigns</option>
            <option value="with_rules">With rules</option>
            <option value="active_rules">Active rules</option>
            <option value="paused_rules">Paused rules</option>
            <option value="snoozed_rules">Snoozed rules</option>
            <option value="with_violations">With violations</option>
            <option value="no_rules">No rules</option>
          </select>
          <span className="text-xs text-slate-400">
            {filteredCampaigns.length} campaign{filteredCampaigns.length !== 1 ? 's' : ''}
            {lastSynced && embedded && <span> · synced {timeAgo(lastSynced)}</span>}
          </span>
        </div>
        {embedded && (
          <button onClick={handleRefresh} disabled={refreshing || !selAccount}
            className="btn-secondary text-xs gap-1.5">
            <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={13} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Ad account tabs */}
      {adAccounts.length > 1 && (
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
          {adAccounts.map(a => (
            <button key={a.ad_account_id} onClick={() => setSelAccount(a.ad_account_id)}
              className={`px-4 py-2 font-medium transition-colors ${
                selAccount === a.ad_account_id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}>
              {a.account_name || a.ad_account_id}
            </button>
          ))}
        </div>
      )}

      {/* Campaigns table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading campaigns…</div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            {adAccounts.length === 0
              ? 'No ad accounts linked to this workspace yet.'
              : campaigns.length === 0
              ? 'No active campaigns found. Campaigns sync every 6 hours.'
              : 'No campaigns match the selected filter.'}
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Campaign / Adset</th>
                <th>Objective</th>
                <th>Budget</th>
                <th title="Budget changes this month">Changes↑</th>
                <th>Rules</th>
                <th>Violations</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map(campaign => {
                const adsets = adsetsByParent[campaign.entity_id] || []
                const isExpanded = expanded.has(campaign.entity_id)
                const hasRules = (campaign.rules?.length || 0) > 0
                const hasViolations = campaign.violations > 0
                const rowHighlight = hasViolations
                  ? 'border-l-2 border-l-red-400 bg-red-50/30'
                  : hasRules
                  ? 'border-l-2 border-l-blue-400 bg-blue-50/20'
                  : ''
                return [
                  <tr key={campaign.entity_id} className={rowHighlight}>
                    <td className="max-w-xs">
                      <div className="flex items-center gap-2">
                        {adsets.length > 0 && (
                          <button onClick={() => toggleExpand(campaign.entity_id)}
                            className="text-slate-400 hover:text-slate-700 w-4 shrink-0 text-center">
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        )}
                        {adsets.length === 0 && <span className="w-4 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{campaign.name}</p>
                          <p className="text-xs text-slate-400">campaign</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">{campaign.objective || '—'}</td>
                    <td className="text-sm text-slate-700 whitespace-nowrap">
                      {campaign.daily_budget != null
                        ? `${fmt(campaign.daily_budget)} / day`
                        : campaign.lifetime_budget != null
                        ? `${fmt(campaign.lifetime_budget)} lifetime`
                        : '—'}
                    </td>
                    <td>
                      {campaign.budget_change_count > 0
                        ? <span className="badge-yellow">{campaign.budget_change_count}×</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td>
                      {campaign.rules?.length > 0
                        ? <button onClick={() => setViewRulesFor(campaign)}
                            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
                            <span className="font-semibold">{campaign.rules.filter(r => r.active).length}</span>
                            <span className="text-slate-400">/ {campaign.rules.length}</span>
                          </button>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td>
                      {campaign.violations > 0
                        ? <span className="badge-red">{campaign.violations}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td>
                      <button onClick={() => setAddRuleFor(campaign)}
                        className="btn-ghost text-xs py-1 px-2 whitespace-nowrap">
                        + Rule
                      </button>
                    </td>
                  </tr>,
                  ...(isExpanded ? adsets.map(adset => (
                    <EntityRow key={adset.entity_id} entity={adset} isAdset
                      wsId={wsId} adAccounts={adAccounts}
                      onAddRule={setAddRuleFor} onViewRules={setViewRulesFor} />
                  )) : [])
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add rule modal */}
      {addRuleFor && (
        <AddRuleModal
          entity={addRuleFor}
          wsId={wsId}
          adAccounts={adAccounts}
          onClose={() => setAddRuleFor(null)}
          onSaved={handleRuleSaved}
        />
      )}

      {/* Rules management panel */}
      {viewRulesFor && (
        <RulesPanel
          entity={viewRulesFor}
          onChanged={handleRulesChanged}
          onClose={() => setViewRulesFor(null)}
        />
      )}
    </div>
  )
}
