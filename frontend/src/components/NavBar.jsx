import { Link, useNavigate } from 'react-router-dom'
import { signOut } from '../lib/auth.js'

export default function NavBar({ role }) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <nav style={{ background: '#1a1a1a', color: '#fff', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
      <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>SpendGuard</span>

      {role === 'super_admin' && (
        <>
          <Link to="/admin" style={{ color: '#ccc', textDecoration: 'none' }}>Workspaces</Link>
        </>
      )}

      {role === 'workspace_user' && (
        <>
          <Link to="/workspace" style={{ color: '#ccc', textDecoration: 'none' }}>Dashboard</Link>
          <Link to="/workspace/campaigns" style={{ color: '#ccc', textDecoration: 'none' }}>Campaigns</Link>
          <Link to="/workspace/activity" style={{ color: '#ccc', textDecoration: 'none' }}>Activity</Link>
          <Link to="/workspace/settings" style={{ color: '#ccc', textDecoration: 'none' }}>Settings</Link>
        </>
      )}

      <button
        onClick={handleSignOut}
        style={{ marginLeft: 'auto', background: 'transparent', color: '#ccc', border: '1px solid #555', padding: '0.3rem 0.8rem', cursor: 'pointer', borderRadius: 4 }}
      >
        Sign out
      </button>
    </nav>
  )
}
