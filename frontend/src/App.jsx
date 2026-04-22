import { Routes, Route, Navigate } from 'react-router-dom'
import Login           from './pages/Login.jsx'
import AcceptInvite    from './pages/AcceptInvite.jsx'
import AdminDashboard  from './pages/admin/Dashboard.jsx'
import Workspaces      from './pages/admin/Workspaces.jsx'
import WorkspaceDetail from './pages/admin/WorkspaceDetail.jsx'
import AllRules        from './pages/admin/AllRules.jsx'
import AllAlerts       from './pages/admin/AllAlerts.jsx'
import AdminActivity   from './pages/admin/AdminActivity.jsx'
import AdminSettings   from './pages/admin/AdminSettings.jsx'
import WorkspaceDashboard from './pages/workspace/Dashboard.jsx'
import CampaignsView   from './pages/workspace/CampaignsView.jsx'
import RulesManager    from './pages/workspace/RulesManager.jsx'
import ActivityLog     from './pages/workspace/ActivityLog.jsx'
import AlertSettings   from './pages/workspace/AlertSettings.jsx'
import PrivateRoute    from './components/PrivateRoute.jsx'

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"          element={<Login />} />
      <Route path="/accept-invite"  element={<AcceptInvite />} />

      {/* Super admin */}
      <Route path="/admin" element={<PrivateRoute requiredRole="super_admin"><AdminDashboard /></PrivateRoute>} />
      <Route path="/admin/workspaces" element={<PrivateRoute requiredRole="super_admin"><Workspaces /></PrivateRoute>} />
      <Route path="/admin/workspaces/:id" element={<PrivateRoute requiredRole="super_admin"><WorkspaceDetail /></PrivateRoute>} />
      <Route path="/admin/rules"    element={<PrivateRoute requiredRole="super_admin"><AllRules /></PrivateRoute>} />
      <Route path="/admin/alerts"   element={<PrivateRoute requiredRole="super_admin"><AllAlerts /></PrivateRoute>} />
      <Route path="/admin/activity" element={<PrivateRoute requiredRole="super_admin"><AdminActivity /></PrivateRoute>} />
      <Route path="/admin/settings" element={<PrivateRoute requiredRole="super_admin"><AdminSettings /></PrivateRoute>} />

      {/* Workspace user */}
      <Route path="/workspace"              element={<PrivateRoute requiredRole="workspace_user"><WorkspaceDashboard /></PrivateRoute>} />
      <Route path="/workspace/campaigns"    element={<PrivateRoute requiredRole="workspace_user"><CampaignsView /></PrivateRoute>} />
      <Route path="/workspace/rules"        element={<PrivateRoute requiredRole="workspace_user"><RulesManager /></PrivateRoute>} />
      <Route path="/workspace/activity"     element={<PrivateRoute requiredRole="workspace_user"><ActivityLog /></PrivateRoute>} />
      <Route path="/workspace/settings"     element={<PrivateRoute requiredRole="workspace_user"><AlertSettings /></PrivateRoute>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
