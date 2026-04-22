import { useEffect, useState } from 'react'
import { getWorkspace, updateWorkspace } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'

export default function AlertSettings() {
  const { user, profile } = useAuth()
  const wsId = profile?.workspace_id

  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    if (!wsId) return
    getWorkspace(wsId).then(ws => {
      setEmail(ws.notification_email || '')
      setLoading(false)
    })
  }, [wsId])

  async function handleSave(e) {
    e.preventDefault()
    setMsg(null)
    setSaving(true)
    try {
      await updateWorkspace(wsId, { notification_email: email })
      setMsg({ ok: true, text: 'Notification email updated.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your workspace preferences</p>
      </div>

      {/* Notification email — read-only for workspace users */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Alert notifications</h2>
        <p className="text-sm text-slate-500 mb-4">
          When a rule is breached, an alert email is sent to the address below. Contact your administrator to change it.
        </p>
        {loading ? (
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
        ) : (
          <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg max-w-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <span className="text-sm text-slate-700 font-medium">{email || user?.email || '—'}</span>
            <span className="ml-auto text-xs text-slate-400">set by admin</span>
          </div>
        )}
      </div>

      {/* Account info */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Account</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-500">Email</span>
            <span className="text-sm font-medium text-slate-800">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-500">Role</span>
            <span className="badge-blue capitalize">{profile?.role?.replace('_', ' ')}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-500">Workspace ID</span>
            <span className="text-sm font-mono text-slate-600">{wsId}</span>
          </div>
        </div>
      </div>

      {/* Password change */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Password</h2>
        <p className="text-sm text-slate-500 mb-4">Send a password reset link to your email address.</p>
        <button
          onClick={async () => {
            await supabase.auth.resetPasswordForEmail(user?.email)
            setMsg({ ok: true, text: 'Password reset email sent.' })
          }}
          className="btn-secondary"
        >
          Send reset email
        </button>
      </div>
    </div>
  )
}
