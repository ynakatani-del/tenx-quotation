import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children, requireAdmin = false, requireSuperAdmin = false }) {
  const { user, profile, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  if (profile?.status !== 'active' || !profile.role || profile.quotation_suspended) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-800">見積管理の利用権限がありません</h1>
          <p className="mt-2 text-sm text-gray-600">利用が必要な場合は、管理者にお問い合わせください。</p>
          <button type="button" onClick={signOut} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">ログアウト</button>
        </div>
      </main>
    )
  }

  if (requireSuperAdmin && profile?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }

  if (requireAdmin && !['super_admin', 'admin', 'maintenance_admin'].includes(profile?.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
