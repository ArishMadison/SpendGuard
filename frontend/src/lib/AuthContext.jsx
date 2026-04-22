import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile()
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile()
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setProfile(null); setLoading(false); return }
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
      const res = await fetch(`${API_URL}/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        setProfile(await res.json())
      } else {
        setProfile(null)
      }
    } catch {
      setProfile(null)
    }
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
