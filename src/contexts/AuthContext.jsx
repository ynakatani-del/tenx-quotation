import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const isSuperAdmin = profile?.role === 'super_admin'
  const isApprover = profile?.role === 'admin' || isSuperAdmin  // 承認可能 = admin + super_admin
  const isMaintenanceAdmin = profile?.role === 'maintenance_admin'
  const isAdmin = isApprover || isMaintenanceAdmin  // 管理機能アクセス可（承認は別）
  const isGeneral = !!profile
  // 見積の閲覧範囲：特権管理者は常に全件、それ以外は profiles.view_scope に従う（実際の制限はDBのRLSで担保）
  const canViewAll = isSuperAdmin || profile?.view_scope === 'all'
  // 承認できる見積か：全件閲覧の管理者は全件、自分関連のみの管理者は自分宛ての依頼のみ
  const canApproveQuotation = (q) => {
    if (!q || !profile) return false
    if (isSuperAdmin) return true
    if (q.requested_approver_id === profile.id) return true
    return isApprover && canViewAll
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, isSuperAdmin, isAdmin, isApprover, isMaintenanceAdmin, isGeneral, canViewAll, canApproveQuotation, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
