import { useAuth } from '../../lib/AuthContext.jsx'
import { supabase } from '../../lib/supabase.js'
import { useState } from 'react'

export default function AdminSettings() {
  const { user } = useAuth()
  const [msg, setMsg] = useState(null)

  async function handlePasswordReset() {
    const { error } = await supabase.auth.resetPasswordForEmail(user?.email)
    if (error) setMsg({ ok: false, text: error.message })
    else setMsg({ ok: true, text: 'Password reset email sent to ' + user?.email })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Super admin account settings</p>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Account</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-500">Email</span>
            <span className="text-sm font-medium text-slate-800">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-sm text-slate-500">Role</span>
            <span className="badge-blue">Super Admin</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-500">User ID</span>
            <span className="text-sm font-mono text-slate-500">{user?.id}</span>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Password</h2>
        <p className="text-sm text-slate-500 mb-4">Send a password reset link to your email address.</p>
        {msg && (
          <p className={`text-sm mb-4 ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
        )}
        <button onClick={handlePasswordReset} className="btn-secondary">
          Send reset email
        </button>
      </div>
    </div>
  )
}
