import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'

// ── Icons (inline SVG, no dep) ────────────────────────────────────────────────
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const Icons = {
  grid:     'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  users:    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  rules:    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  bell:     'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 0v3m0-12V3m9 9h-3M6 12H3m15.364 6.364-2.121-2.121M8.757 8.757 6.636 6.636m12.728 0-2.121 2.121M8.757 15.243l-2.121 2.121',
  logout:   'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  shield:   'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  chart:    'M3 3v18h18M18 9l-5 5-4-4-3 3',
  workspace:'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  menu:     'M3 12h18M3 6h18M3 18h18',
  x:        'M18 6 6 18M6 6l12 12',
  chevron:  'M9 18l6-6-6-6',
}

const ADMIN_NAV = [
  { to: '/admin',            icon: 'grid',      label: 'Overview',   end: true },
  { to: '/admin/workspaces', icon: 'workspace', label: 'Workspaces' },
  { to: '/admin/rules',      icon: 'rules',     label: 'All Rules'  },
  { to: '/admin/alerts',     icon: 'bell',      label: 'All Alerts' },
  { to: '/admin/activity',   icon: 'activity',  label: 'Activity'   },
  { to: '/admin/settings',   icon: 'settings',  label: 'Settings'   },
]

const WORKSPACE_NAV = [
  { to: '/workspace',           icon: 'chart',    label: 'Dashboard', end: true },
  { to: '/workspace/campaigns', icon: 'activity', label: 'Campaigns'  },
  { to: '/workspace/rules',     icon: 'rules',    label: 'Rules'      },
  { to: '/workspace/activity',  icon: 'bell',     label: 'Alerts'     },
  { to: '/workspace/settings',  icon: 'settings', label: 'Settings'   },
]

export default function AppShell({ role, children, user }) {
  const navigate   = useNavigate()
  const [open, setOpen] = useState(false)
  const nav = role === 'super_admin' ? ADMIN_NAV : WORKSPACE_NAV

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const initials = user?.email?.slice(0, 2).toUpperCase() || 'U'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-60 flex flex-col bg-slate-900 transition-transform duration-200
        lg:static lg:translate-x-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
            <Icon d={Icons.shield} size={14} />
          </div>
          <span className="text-white font-semibold tracking-tight">SpendGuard</span>
          {role === 'super_admin' && (
            <span className="ml-auto text-[10px] font-semibold bg-brand-500/20 text-brand-100 px-1.5 py-0.5 rounded">ADMIN</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, icon, label, end }) => (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' active' : ''}`
              }
              onClick={() => setOpen(false)}
            >
              <Icon d={Icons[icon]} size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 py-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{user?.email || 'User'}</p>
              <p className="text-slate-500 text-[11px] capitalize">{role?.replace('_', ' ')}</p>
            </div>
            <button onClick={handleSignOut} className="text-slate-400 hover:text-white transition-colors" title="Sign out">
              <Icon d={Icons.logout} size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 gap-4 shrink-0 z-10">
          <button className="lg:hidden text-slate-500 hover:text-slate-700" onClick={() => setOpen(true)}>
            <Icon d={Icons.menu} size={20} />
          </button>
          <div className="flex-1" />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
