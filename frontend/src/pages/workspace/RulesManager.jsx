import { useEffect, useState } from 'react'
import EntityPicker from '../../components/EntityPicker.jsx'
import { listRules, createRule, listAdAccounts, validateEntity, updateRule, deleteRule, toggleRule } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const METRICS = [
  { value: 'campaign_objective',              label: "Campaign objective",         desc: "Alert when the campaign's objective is or isn't a specific type.", kind: 'string' },
  { value: 'budget_level',                    label: 'Budget level',               desc: "Alert when budget is set at campaign level (CBO) or adset level (ABO).", kind: 'string' },
  { value: 'budget_type',                     label: 'Budget type',                desc: "Alert when budget is daily or lifetime.", kind: 'string' },
  { value: 'budget_threshold',                label: 'Budget threshold',           desc: "Alert when remaining daily or lifetime budget crosses a value.", kind: 'numeric' },
  { value: 'budget_change_frequency_monthly', label: 'Budget change frequency',    desc: "Alert when budget has been changed more than N times this month.", kind: 'numeric' },
]

const OBJECTIVES = [
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS',
  'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION',
]

const OPERATOR_LABELS = { '<': 'below', '>': 'above', '=': 'exactly' }

const defaultForm = {
  alert_name: '', metric: 'budget_threshold', operator: '>', threshold: '',
  budget_mode: 'daily', entity_id: '', entity_type: '', entity_name: '', ad_account_id: '',
}

function RuleRow({ rule, onChanged }) {
  const [toggling,  setToggling]  = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [snoozeVal, setSnoozeVal] = useState('')
  const [showSnooze, setShowSnooze] = useState(false)

  const isSnoozed = rule.snooze_until && new Date(rule.snooze_until) > new Date()

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
    setShowSnooze(false)
    onChanged()
  }

  return (
    <tr>
      <td>
        <p className="font-medium text-slate-900">{rule.alert_name || '—'}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{rule.entity_name || rule.entity_id}</p>
      </td>
      <td><span className="badge-blue">{rule.metric}</span></td>
      <td className="font-mono text-xs text-slate-600">{rule.operator} {rule.threshold}</td>
      <td>
        {isSnoozed
          ? <span className="badge-yellow">Snoozed</span>
          : rule.active
          ? <span className="badge-green">Active</span>
          : <span className="badge-gray">Paused</span>}
      </td>
      <td>
        <div className="flex items-center gap-1.5">
          <button onClick={handleToggle} disabled={toggling}
            className="btn-ghost text-xs py-1 px-2">
            {rule.active ? 'Pause' : 'Resume'}
          </button>
          <button onClick={() => setShowSnooze(s => !s)}
            className="btn-ghost text-xs py-1 px-2">
            Snooze
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="btn-ghost text-xs py-1 px-2 text-red-500 hover:bg-red-50">
            Delete
          </button>
        </div>
        {showSnooze && (
          <div className="flex items-center gap-2 mt-2">
            <input type="datetime-local" value={snoozeVal} onChange={e => setSnoozeVal(e.target.value)}
              className="input text-xs py-1 w-44" />
            <button onClick={handleSnooze} className="btn-primary text-xs py-1">Set</button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function RulesManager({ workspaceId: propWorkspaceId } = {}) {
  const { profile } = useAuth()
  const wsId = propWorkspaceId ?? profile?.workspace_id

  const [rules,       setRules]       = useState([])
  const [adAccounts,  setAdAccounts]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showForm,    setShowForm]    = useState(false)
  const [form,        setForm]        = useState(defaultForm)
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState(null)
  const [validating,  setValidating]  = useState(false)
  const [entityValid, setEntityValid] = useState(null)
  const [entityMeta,  setEntityMeta]  = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => { if (wsId) loadData() }, [wsId])

  async function loadData() {
    setLoading(true)
    try {
      const [rl, ac] = await Promise.all([listRules(wsId), listAdAccounts(wsId)])
      setRules(rl)
      setAdAccounts(ac)
    } finally { setLoading(false) }
  }

  function handleEntitySelect({ entity_id, entity_type, entity_name, ad_account_id }) {
    setForm(p => ({ ...p, entity_id, entity_type, entity_name, ad_account_id }))
    setEntityValid(null)
    setEntityMeta(null)
    checkEntity(entity_id)
  }

  async function checkEntity(entityId) {
    setValidating(true)
    try {
      const data = await validateEntity(entityId, wsId)
      setEntityValid(data?.valid === true)
      if (data?.entity) setEntityMeta(data.entity)
    } catch { setEntityValid(false) }
    finally { setValidating(false) }
  }

  function handleMetricChange(metric) {
    const def = METRICS.find(m => m.value === metric)
    setForm(p => ({
      ...defaultForm,
      alert_name: p.alert_name,
      entity_id: p.entity_id, entity_type: p.entity_type,
      entity_name: p.entity_name, ad_account_id: p.ad_account_id,
      metric,
      operator: def?.kind === 'string' ? 'equals_string' : '>',
      threshold: '',
    }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaveError(null)
    const showCBOWarning = form.metric === 'budget_threshold' && form.entity_type === 'adset' && entityMeta?.campaign_budget_opt === true
    if (showCBOWarning) {
      setSaveError('This adset is under CBO — set the rule on the campaign instead.')
      return
    }
    setSaving(true)
    try {
      const threshold = form.metric === 'budget_threshold' ? `${form.budget_mode}:${form.threshold}` : form.threshold
      await createRule({
        workspace_id: wsId, ad_account_id: form.ad_account_id,
        entity_type: form.entity_type, entity_id: form.entity_id, entity_name: form.entity_name,
        metric: form.metric, operator: form.operator, threshold,
        alert_name: form.alert_name,
      })
      setForm(defaultForm)
      setShowForm(false)
      setEntityValid(null)
      setEntityMeta(null)
      await loadData()
    } catch (err) { setSaveError(err.message) }
    finally { setSaving(false) }
  }

  const filteredRules = rules.filter(r => {
    if (filterStatus === 'active')  return r.active
    if (filterStatus === 'paused')  return !r.active
    if (filterStatus === 'snoozed') return r.snooze_until && new Date(r.snooze_until) > new Date()
    return true
  })

  const metricDef         = METRICS.find(m => m.value === form.metric)
  const isBudgetThreshold = form.metric === 'budget_threshold'
  const isBudgetChange    = form.metric === 'budget_change_frequency_monthly'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Rules</h1>
          <p className="text-sm text-slate-500 mt-0.5">{rules.filter(r => r.active).length} active · {rules.length} total</p>
        </div>
        <button onClick={() => { setShowForm(true); setSaveError(null) }} className="btn-primary">
          <Icon d="M12 5v14M5 12h14" size={15} /> Add rule
        </button>
      </div>

      {/* Rule builder modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="card w-full max-w-xl p-6 my-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">New rule</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <Icon d="M18 6 6 18M6 6l12 12" size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {/* Alert name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Alert name <span className="text-slate-400 font-normal">(optional)</span></label>
                <input className="input" placeholder="e.g. Low daily budget — Brand Campaign"
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

              {/* Entity picker */}
              <EntityPicker workspaceId={wsId} adAccounts={adAccounts} onSelect={handleEntitySelect} />

              {/* Entity status */}
              {form.entity_id && (
                <p className={`text-xs ${validating ? 'text-amber-600' : entityValid ? 'text-emerald-600' : 'text-red-500'}`}>
                  {validating ? 'Checking entity...' : entityValid ? 'Entity found in cache' : 'Entity not found'}
                </p>
              )}

              {/* CBO warning */}
              {isBudgetThreshold && form.entity_type === 'adset' && entityMeta?.campaign_budget_opt && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  This adset is under Campaign Budget Optimisation — budget is controlled at the campaign level. Set this rule on the campaign instead.
                </div>
              )}

              {/* ── String: campaign_objective ──────────────────────── */}
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

              {/* ── String: budget_level ────────────────────────────── */}
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
                      {[['campaign', 'Campaign (CBO)'], ['adset', 'Adset (ABO)']].map(([v, l]) => (
                        <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="rm_budget_level" value={v} checked={form.threshold === v}
                            onChange={() => setForm(p => ({ ...p, threshold: v }))} className="accent-slate-900" />
                          <span className="text-sm text-slate-700">{l}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── String: budget_type ─────────────────────────────── */}
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
                          <input type="radio" name="rm_budget_type" value={v} checked={form.threshold === v}
                            onChange={() => setForm(p => ({ ...p, threshold: v }))} className="accent-slate-900" />
                          <span className="text-sm text-slate-700">{l}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Numeric: budget_threshold ───────────────────────── */}
              {isBudgetThreshold && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <p className="text-sm font-medium text-slate-700">Alert me when budget is</p>
                  <div className="flex gap-3 mb-2">
                    {[['daily', 'Daily budget'], ['lifetime_remaining', 'Lifetime remaining']].map(([v, l]) => (
                      <label key={v} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="rm_budget_mode" value={v} checked={form.budget_mode === v}
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

              {/* ── Numeric: budget_change_frequency ────────────────── */}
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

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={saving || !form.entity_id || !form.threshold} className="btn-primary flex-1 justify-center">
                  {saving ? 'Saving...' : 'Save rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm w-fit">
        {['all', 'active', 'paused', 'snoozed'].map(f => (
          <button key={f} onClick={() => setFilterStatus(f)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              filterStatus === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* Rules table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-slate-500">No rules found.</p>
            <button onClick={() => setShowForm(true)} className="btn-primary mt-3 text-xs">Add first rule</button>
          </div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Alert name / Entity</th>
                <th>Metric</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map(r => (
                <RuleRow key={r.id} rule={r} onChanged={loadData} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
