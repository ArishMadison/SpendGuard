import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getWorkspace, sendInvite, removeUser, fetchAdAccounts, linkAdAccount, listAlerts, listRules, updateWorkspace } from '../../lib/api.js'
import CampaignsView from '../workspace/CampaignsView.jsx'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const TABS = ['Campaigns & Rules', 'Alerts', 'Settings']

function friendlyError(msg = '') {
  if (!msg) return 'Something went wrong. Please try again.'
  const m = msg.toLowerCase()
  if (m.includes('10 ad account limit'))   return msg  // already readable
  if (m.includes('unauthorized') || m.includes('401')) return 'Session expired. Please log in again.'
  if (m.includes('forbidden')   || m.includes('403')) return 'You do not have permission to perform this action.'
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
    return 'Could not reach the server. Check your connection and try again.'
  if (m.includes('invalid token') || m.includes('access token'))
    return 'The token appears to be invalid. Check it and try again.'
  if (m.includes('(#200)') || m.includes('does not have permission'))
    return 'This token does not have permission to read ad accounts.'
  if (m.includes('(#190)') || m.includes('invalid oauth'))
    return 'The token is expired or invalid. Please generate a new System User token.'
  if (m.includes('rate limit') || m.includes('(#17)'))
    return 'Meta API rate limit reached. Please wait a few minutes and try again.'
  if (m.includes('sendgrid'))   return 'Failed to send email. Check the SendGrid configuration.'
  if (m.includes('duplicate') || m.includes('already exists'))
    return 'This record already exists.'
  if (m.includes('unique') || m.includes('conflict'))
    return 'A conflict occurred saving this record. Please try again.'
  // fallback: return original but strip Postgres/PostgREST boilerplate
  return msg.replace(/^(error:|hint:|detail:)\s*/i, '').trim() || 'An unexpected error occurred.'
}

export default function WorkspaceDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const wsId     = parseInt(id)

  const [workspace,          setWorkspace]          = useState(null)
  const [loading,            setLoading]            = useState(true)
  const [tab,                setTab]                = useState('Campaigns & Rules')
  const [rules,              setRules]              = useState([])
  const [alerts,             setAlerts]             = useState([])
  const [assignedUserEmail,  setAssignedUserEmail]  = useState(null)

  // Invite
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting,    setInviting]    = useState(false)
  const [inviteMsg,   setInviteMsg]   = useState(null)
  const [revoking,    setRevoking]    = useState(false)

  // Notification email (admin editable, inline edit mode)
  const [notifEmail,   setNotifEmail]   = useState('')
  const [editingEmail, setEditingEmail] = useState(false)
  const [savingEmail,  setSavingEmail]  = useState(false)
  const [emailMsg,     setEmailMsg]     = useState(null)

  // Ad account linking
  const [fetchedAccounts, setFetchedAccounts] = useState(null)
  const [fetchError,      setFetchError]      = useState(null)
  const [fetching,        setFetching]        = useState(false)
  const [linkingIds,      setLinkingIds]      = useState(new Set())
  const [linkedIds,       setLinkedIds]       = useState(new Set())
  const [accountSearch,   setAccountSearch]   = useState('')

  useEffect(() => { loadAll() }, [id])

  // Auto-load Meta ad accounts when Ad Accounts tab is opened
  useEffect(() => {
    if (tab !== 'Settings' || fetchedAccounts !== null || fetching) return
    loadMetaAccounts()
  }, [tab])

  async function loadAll() {
    setLoading(true)
    try {
      const [ws, rl, al] = await Promise.all([
        getWorkspace(wsId),
        listRules(wsId),
        listAlerts(wsId),
      ])
      setWorkspace(ws)
      setNotifEmail(ws.notification_email || '')
      setRules(rl)
      setAlerts(al)
      setAssignedUserEmail(ws.assigned_user_email || null)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveNotifEmail(e) {
    e.preventDefault()
    setEmailMsg(null)
    setSavingEmail(true)
    try {
      await updateWorkspace(wsId, { notification_email: notifEmail || null })
      setEmailMsg({ ok: true, text: 'Notification email updated.' })
      await loadAll()
    } catch (err) {
      setEmailMsg({ ok: false, text: friendlyError(err.message) })
    } finally {
      setSavingEmail(false)
    }
  }

  async function handleSendInvite(e) {
    e.preventDefault()
    setInviteMsg(null)
    setInviting(true)
    try {
      await sendInvite(wsId, inviteEmail)
      setInviteMsg({ ok: true, text: `Invite sent to ${inviteEmail}` })
      setInviteEmail('')
    } catch (err) {
      setInviteMsg({ ok: false, text: friendlyError(err.message) })
    } finally {
      setInviting(false)
    }
  }

  async function handleRevoke() {
    if (!window.confirm("Remove this user? Their account will be deleted. The workspace and all its rules are preserved. You can re-invite someone afterwards.")) return
    setRevoking(true)
    try { await removeUser(wsId); await loadAll() }
    catch (err) { alert('Failed to remove user: ' + err.message) }
    finally { setRevoking(false) }
  }

  async function loadMetaAccounts({ bust = false } = {}) {
    setFetchError(null)
    setFetching(true)
    try {
      const data = await fetchAdAccounts({ bust })
      setFetchedAccounts(data.ad_accounts || [])
    } catch (err) { setFetchError(friendlyError(err.message)) }
    finally { setFetching(false) }
  }

  async function handleLink(account) {
    setLinkingIds(prev => new Set(prev).add(account.id))
    try {
      await linkAdAccount({ workspace_id: wsId, ad_account_id: account.id, account_name: account.name })
      setLinkedIds(prev => new Set(prev).add(account.id))
      await loadAll()
    } catch (err) { setFetchError(friendlyError(err.message)) }
    finally { setLinkingIds(prev => { const s = new Set(prev); s.delete(account.id); return s }) }
  }

  if (loading) return <div className="p-8 text-sm text-slate-400">Loading...</div>
  if (!workspace) return <div className="p-8 text-sm text-slate-500">Workspace not found.</div>

  const linked       = new Set((workspace.workspace_ad_accounts || []).map(a => a.ad_account_id))
  const activeAlerts = alerts.filter(a => !a.resolved_at)
  const activeRules  = rules.filter(r => r.active)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Breadcrumb + header */}
      <div>
        <button onClick={() => navigate('/admin/workspaces')}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-3">
          <Icon d="M15 18l-6-6 6-6" size={13} /> Workspaces
        </button>
        <h1 className="text-xl font-semibold text-slate-900">{workspace.name}</h1>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Ad accounts</p>
          <p className="text-2xl font-bold text-slate-900">{workspace.workspace_ad_accounts?.length ?? 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Active rules</p>
          <p className="text-2xl font-bold text-slate-900">{activeRules.length}</p>
          <p className="text-xs text-slate-400">{rules.length} total</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Active alerts</p>
          <p className={`text-2xl font-bold ${activeAlerts.length > 0 ? 'text-red-600' : 'text-slate-900'}`}>{activeAlerts.length}</p>
          <p className="text-xs text-slate-400">{alerts.length} total</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t}
              {t === 'Alerts' && activeAlerts.length > 0 && (
                <span className="ml-1.5 bg-red-100 text-red-600 text-xs rounded-full px-1.5 py-0.5">{activeAlerts.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Campaigns & Rules tab ────────────────────────────────────────── */}
      {tab === 'Campaigns & Rules' && (
        <CampaignsView workspaceId={wsId} embedded />
      )}

      {/* ── Alerts tab ────────────────────────────────────────────────────── */}
      {tab === 'Alerts' && (
        <div className="card overflow-hidden">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No alerts for this workspace.</div>
          ) : (
            <table className="table-base">
              <thead><tr><th>Entity</th><th>Metric</th><th>Actual</th><th>Status</th><th>First seen</th></tr></thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.id}>
                    <td className="font-medium text-slate-900 max-w-xs truncate">{a.entity_name || a.entity_id}</td>
                    <td><span className="badge-blue">{a.metric}</span></td>
                    <td className="font-mono text-xs text-slate-700">{a.actual_value}</td>
                    <td>
                      {a.resolved_at
                        ? <span className="badge-green">Resolved</span>
                        : <span className="badge-red">Active</span>}
                    </td>
                    <td className="text-xs text-slate-400">{new Date(a.first_alerted_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Settings tab ──────────────────────────────────────────────────── */}
      {tab === 'Settings' && (
        <div className="space-y-5">
          {/* User access */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">User access</h3>
            {workspace.user_id ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                      {assignedUserEmail ? assignedUserEmail[0].toUpperCase() : 'U'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {assignedUserEmail || 'User assigned'}
                      </p>
                      <p className="text-xs text-slate-500">workspace user · active access</p>
                    </div>
                  </div>
                  <button onClick={handleRevoke} disabled={revoking} className="btn-danger text-xs">
                    {revoking ? 'Removing...' : 'Remove user'}
                  </button>
                </div>
                <details className="text-sm">
                  <summary className="text-slate-400 cursor-pointer hover:text-slate-600 text-xs">Send invite to a different email</summary>
                  <form onSubmit={handleSendInvite} className="flex gap-2 mt-2">
                    <input type="email" placeholder="new@client.com" value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)} required className="input flex-1" />
                    <button type="submit" disabled={inviting} className="btn-primary whitespace-nowrap text-xs">
                      {inviting ? 'Sending...' : 'Send invite'}
                    </button>
                  </form>
                  {inviteMsg && (
                    <p className={`text-xs mt-1.5 ${inviteMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{inviteMsg.text}</p>
                  )}
                </details>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">No user assigned. Send an invite to grant access.</p>
                <form onSubmit={handleSendInvite} className="flex gap-2">
                  <input type="email" placeholder="user@client.com" value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)} required className="input flex-1" />
                  <button type="submit" disabled={inviting} className="btn-primary whitespace-nowrap">
                    {inviting ? 'Sending...' : 'Send invite'}
                  </button>
                </form>
                {inviteMsg && (
                  <p className={`text-sm ${inviteMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{inviteMsg.text}</p>
                )}
              </div>
            )}
          </div>

          {/* Alert delivery */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Alert delivery</h3>
            <p className="text-sm text-slate-500 mb-4">
              Alert emails go to this address when a rule is breached. Auto-set from the invited user's email.
            </p>
            {!editingEmail ? (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
                <span className="text-sm text-slate-700 flex-1">{notifEmail || <span className="text-slate-400 italic">using user's account email</span>}</span>
                <button
                  onClick={() => { setEditingEmail(true); setEmailMsg(null) }}
                  className="text-slate-400 hover:text-slate-700 transition-colors p-0.5 rounded"
                  title="Edit notification email">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            ) : (
              <form onSubmit={async e => {
                e.preventDefault()
                await handleSaveNotifEmail(e)
                setEditingEmail(false)
              }} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input type="email" value={notifEmail} autoFocus
                    onChange={e => { setNotifEmail(e.target.value); setEmailMsg(null) }}
                    placeholder="alerts@client.com"
                    className="input" />
                  {emailMsg && (
                    <p className={`text-xs mt-1.5 ${emailMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{emailMsg.text}</p>
                  )}
                </div>
                <button type="submit" disabled={savingEmail} className="btn-primary whitespace-nowrap">
                  {savingEmail ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => { setEditingEmail(false); setEmailMsg(null) }}
                  className="btn-secondary whitespace-nowrap">
                  Cancel
                </button>
              </form>
            )}
          </div>

          {/* Ad accounts */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-slate-900">Ad accounts</h3>
              <div className="flex items-center gap-2">
                {fetching && <span className="text-xs text-slate-400">Loading accounts…</span>}
                {!fetching && fetchedAccounts !== null && (
                  <button onClick={() => loadMetaAccounts({ bust: true })} className="btn-ghost text-xs py-1 px-2">Refresh</button>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  (workspace.workspace_ad_accounts?.length ?? 0) >= 10
                    ? 'bg-red-100 text-red-600'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                  {workspace.workspace_ad_accounts?.length ?? 0} / 10 accounts
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Link ad accounts accessible via the platform's System User token.
              {(workspace.workspace_ad_accounts?.length ?? 0) >= 10 && (
                <span className="block mt-1 text-red-600 font-medium">Limit reached — remove an account before linking a new one.</span>
              )}
            </p>
            {fetchError && (
              <div className="flex items-center gap-2 mt-2">
                <p className="text-sm text-red-600 flex-1">{fetchError}</p>
                <button onClick={loadMetaAccounts} className="btn-ghost text-xs py-1 px-2">Retry</button>
              </div>
            )}
          </div>

          {/* Fetched Meta accounts */}
          {fetching && fetchedAccounts === null && (
            <div className="card p-8 text-center text-sm text-slate-400">Loading ad accounts from Meta…</div>
          )}

          {fetchedAccounts !== null && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700 shrink-0">
                  {fetchedAccounts.length} accounts accessible
                </p>
                <input
                  className="input py-1.5 text-sm w-56"
                  placeholder="Search accounts..."
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                />
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {fetchedAccounts
                  .filter(acc => {
                    if (!accountSearch) return true
                    const s = accountSearch.toLowerCase()
                    return acc.name?.toLowerCase().includes(s) || acc.id?.toLowerCase().includes(s)
                  })
                  .map(acc => {
                  const isLinked  = linked.has(acc.id) || linkedIds.has(acc.id)
                  const isLinking = linkingIds.has(acc.id)
                  return (
                    <div key={acc.id} className={`flex items-center justify-between px-5 py-3 ${isLinked ? 'bg-emerald-50/50' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{acc.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{acc.id} · {acc.currency} {!acc.active && '· Inactive'}</p>
                      </div>
                      {isLinked
                        ? <span className="badge-green ml-4 shrink-0">Linked</span>
                        : <button onClick={() => handleLink(acc)} disabled={isLinking}
                            className="btn-primary ml-4 text-xs shrink-0 py-1.5">
                            {isLinking ? 'Linking...' : 'Link'}
                          </button>
                      }
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Already linked */}
          {workspace.workspace_ad_accounts?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-900">Linked to this workspace</p>
              </div>
              <table className="table-base">
                <thead><tr><th>Account ID</th><th>Name</th><th>Status</th><th>Linked</th></tr></thead>
                <tbody>
                  {workspace.workspace_ad_accounts.map(a => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">{a.ad_account_id}</td>
                      <td>{a.account_name || '—'}</td>
                      <td><span className={a.is_active ? 'badge-green' : 'badge-gray'}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td className="text-slate-400 text-xs">{new Date(a.linked_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!workspace.workspace_ad_accounts?.length && fetchedAccounts === null && (
            <div className="card p-8 text-center text-sm text-slate-400">No ad accounts linked yet.</div>
          )}
        </div>
      )}
    </div>
  )
}
