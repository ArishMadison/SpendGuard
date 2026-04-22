import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import AppShell from './layout/AppShell.jsx'

export default function PrivateRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (requiredRole && profile?.role !== requiredRole) {
    const redirect = profile?.role === 'super_admin' ? '/admin' : '/workspace'
    return <Navigate to={redirect} replace />
  }

  return (
    <AppShell role={profile?.role} user={user}>
      {children}
    </AppShell>
  )
}
