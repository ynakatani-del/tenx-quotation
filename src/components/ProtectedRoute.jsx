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

  // role が NULL = 見積アプリ利用不可（利用可否は統合アカウント管理コンソールで設定）
  if (profile && !profile.role) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-4 text-center">
        <p className="font-bold text-gray-800">利用権限がありません</p>
        <p className="text-sm text-gray-500">
          このアカウントには見積アプリの利用権限が設定されていません。<br />
          利用が必要な場合は管理者にお問い合わせください。
        </p>
        <button
          onClick={signOut}
          className="mt-2 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-700"
        >
          ログアウト
        </button>
      </div>
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
