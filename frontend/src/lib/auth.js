import { supabase } from './supabase.js'

/**
 * Returns the current user's role ('super_admin' | 'workspace_user' | null)
 */
export async function getRole() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data.role
}

/**
 * Returns the current user's workspace_id (integer | null)
 */
export async function getWorkspaceId() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data.workspace_id
}

/**
 * Returns both role and workspace_id in one call.
 */
export async function getUserProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('role, workspace_id')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return { ...data, userId: user.id, email: user.email }
}

export async function signOut() {
  await supabase.auth.signOut()
}
