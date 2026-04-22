import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listWorkspaces, createWorkspace, sendInvite, fetchAdAccounts, linkAdAccount } from '../../lib/api.js'

const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

function friendlyError(msg = '') {
  if (!msg) return 'Something went wrong. Please try again.'
  const m = msg.toLowerCase()
  if (m.includes('10 ad account limit'))   return msg
  if (m.includes('unauthorized') || m.includes('401')) return 'Session expired. Please log in again.'
  if (m.includes('forbidden')   || m.includes('403')) return 'You do not have permission to perform this action.'
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
    return 'Could not reach the server. Check your connection and try again.'
  if (m.includes('(#190)') || m.includes('invalid oauth'))
    return 'The token is expired or invalid. Please generate a new System User token.'
  if (m.includes('(#200)') || m.includes('does not have permission'))
    return 'This token does not have permission to read ad accounts.'
  if (m.includes('rate limit') || m.includes('(#17)'))
    return 'Meta API rate limit reached. Please wait a few minutes and try again.'
  return msg.replace(/^(error:|hint:|detail:)\s*/i, '').trim() || 'An unexpected error occurred.'
}

// ── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ workspace, onClose, onDone }) {
  const [email,    setEmail]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [msg,      setMsg]      = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)
    setSending(true)
    try {
      await sendInvite(workspace.id, email)
      setMsg({ ok: true, text: `Invite sent to ${email}` })
      setEmail('')
      onDone()
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err.message) })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Send invite</h2>
            <p className="text-xs text-slate-500 mt-0.5">{workspace.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icon d="M18 6 6 18M6 6l12 12" size={18} />
          </button>
        </div>
        {workspace.user_id && (
          <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            This workspace already has a user assigned. Sending a new invite will not replace them — revoke access first if you want to reassign.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="user@client.com" className="input" autoFocus />
          </div>
          {msg && (
            <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={sending} className="btn-primary flex-1 justify-center">
              {sending ? 'Sending...' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Link Account Modal ────────────────────────────────────────────────────────
function LinkAccountModal({ workspace, onClose, onDone }) {
  const [fetchedAccounts, setFetchedAccounts] = useState(null)
  const [fetchError,      setFetchError]      = useState(null)
  const [fetching,        setFetching]        = useState(true)
  const [linkingIds,      setLinkingIds]      = useState(new Set())
  const [linkedIds,       setLinkedIds]       = useState(new Set())
  const [accountSearch,   setAccountSearch]   = useState('')

  const alreadyLinked = new Set((workspace.workspace_ad_accounts || []).map(a => a.ad_account_id))
  const accountCount  = workspace.workspace_ad_accounts?.length ?? 0

  // Auto-load on open (uses session cache if available)
  useEffect(() => { load() }, [])

  async function load({ bust = false } = {}) {
    setFetchError(null)
    setFetching(true)
    try {
      const data = await fetchAdAccounts({ bust })
      setFetchedAccounts(data.ad_accounts || [])
    } catch (err) {
      setFetchError(friendlyError(err.message))
    } finally {
      setFetching(false)
    }
  }

  async function handleLink(acc) {
    setLinkingIds(prev => new Set(prev).add(acc.id))
    try {
      await linkAdAccount({ workspace_id: workspace.id, ad_account_id: acc.id, account_name: acc.name })
      setLinkedIds(prev => new Set(prev).add(acc.id))
      onDone()
    } catch (err) {
      setFetchError(friendlyError(err.message))
    } finally {
      setLinkingIds(prev => { const s = new Set(prev); s.delete(acc.id); return s })
    }
  }

  const visibleAccounts = (fetchedAccounts || []).filter(acc => {
    if (!accountSearch) return true
    const s = accountSearch.toLowerCase()
    return acc.name?.toLowerCase().includes(s) || acc.id?.toLowerCase().includes(s)
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="card w-full max-w-lg p-6 my-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Link ad account</h2>
            <p className="text-xs text-slate-500 mt-0.5">{workspace.name} · {accountCount}/10 accounts</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icon d="M18 6 6 18M6 6l12 12" size={18} />
          </button>
        </div>

        {accountCount >= 10 && (
          <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            This workspace has reached the 10 ad account limit.
          </div>
        )}

        {fetching && (
          <div className="py-8 text-center text-sm text-slate-400">Loading ad accounts…</div>
        )}

        {fetchError && !fetching && (
          <div className="flex items-center gap-2 mb-4">
            <p className="text-sm text-red-600 flex-1">{fetchError}</p>
            <button onClick={() => load({ bust: true })} className="btn-ghost text-xs py-1 px-2">Retry</button>
          </div>
        )}

        {fetchedAccounts !== null && !fetching && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm text-slate-600 flex-1">
                {fetchedAccounts.length} accounts accessible
              </p>
              <input className="input py-1 text-sm w-44"
                placeholder="Search..."
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)} />
            </div>
            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100">
              {visibleAccounts.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-400">No accounts match your search.</p>
              ) : visibleAccounts.map(acc => {
                const isLinked  = alreadyLinked.has(acc.id) || linkedIds.has(acc.id)
                const isLinking = linkingIds.has(acc.id)
                return (
                  <div key={acc.id} className={`flex items-center justify-between px-4 py-2.5 ${isLinked ? 'bg-emerald-50/50' : ''}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{acc.name}</p>
                      <p className="text-xs text-slate-400">{acc.id} · {acc.currency}</p>
                    </div>
                    {isLinked
                      ? <span className="badge-green ml-3 shrink-0">✓ Linked</span>
                      : <button onClick={() => handleLink(acc)} disabled={isLinking || accountCount >= 10}
                          className="btn-primary ml-3 text-xs py-1 shrink-0">
                          {isLinking ? 'Linking...' : 'Link'}
                        </button>
                    }
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="btn-secondary">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Workspaces() {
  const navigate = useNavigate()
  const [workspaces,    setWorkspaces]    = useState([])
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [showCreate,    setShowCreate]    = useState(false)
  const [form,          setForm]          = useState({ name: '' })
  const [creating,      setCreating]      = useState(false)
  const [createErr,     setCreateErr]     = useState(null)
  const [inviteTarget,  setInviteTarget]  = useState(null)  // workspace obj
  const [linkTarget,    setLinkTarget]    = useState(null)  // workspace obj

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try { setWorkspaces(await listWorkspaces()) }
    finally { setLoading(false) }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateErr(null)
    setCreating(true)
    try {
      const ws = await createWorkspace(form)
      setShowCreate(false)
      setForm({ name: '', client_name: '' })
      navigate(`/admin/workspaces/${ws.id}`)
    } catch (err) { setCreateErr(err.message) }
    finally { setCreating(false) }
  }

  const filtered = workspaces.filter(w =>
    w.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Workspaces</h1>
          <p className="text-sm text-slate-500 mt-0.5">{workspaces.length} total</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Icon d="M12 5v14M5 12h14" size={15} /> New workspace
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <Icon d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" size={15} />
        </div>
        <input className="input pl-9" placeholder="Search workspaces..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">No workspaces found.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Ad accounts</th>
                <th>User</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ws => (
                <tr key={ws.id}>
                  <td>
                    <button
                      onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
                      className="font-medium text-slate-900 hover:text-slate-600 text-left">
                      {ws.name}
                    </button>
                  </td>
                  <td>
                    <span className={`text-sm ${(ws.workspace_ad_accounts?.length ?? 0) >= 10 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {ws.workspace_ad_accounts?.length ?? 0}/10
                    </span>
                  </td>
                  <td>
                    {ws.user_id
                      ? <span className="badge-green">Assigned</span>
                      : <span className="badge-yellow">No user</span>}
                  </td>
                  <td className="text-slate-400 text-xs">{new Date(ws.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setInviteTarget(ws)}
                        className="btn-ghost text-xs py-1 px-2">
                        Invite
                      </button>
                      <button
                        onClick={() => setLinkTarget(ws)}
                        className="btn-ghost text-xs py-1 px-2">
                        Link account
                      </button>
                      <button
                        onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
                        className="btn-ghost text-xs py-1 px-2 text-slate-400">
                        <Icon d="M9 18l6-6-6-6" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create workspace modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-slate-900">New workspace</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
                <Icon d="M18 6 6 18M6 6l12 12" size={18} />
              </button>
            </div>
            {createErr && <p className="text-sm text-red-600 mb-4">{createErr}</p>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Workspace name</label>
                <input className="input" placeholder="e.g. Acme Corp" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={creating} className="btn-primary flex-1 justify-center">
                  {creating ? 'Creating...' : 'Create workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteTarget && (
        <InviteModal
          workspace={inviteTarget}
          onClose={() => setInviteTarget(null)}
          onDone={() => { load(); setInviteTarget(null) }}
        />
      )}

      {/* Link account modal */}
      {linkTarget && (
        <LinkAccountModal
          workspace={workspaces.find(w => w.id === linkTarget.id) || linkTarget}
          onClose={() => setLinkTarget(null)}
          onDone={() => load()}
        />
      )}
    </div>
  )
}
