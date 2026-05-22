import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children, requireAdmin = false, requireSuperAdmin = false }) {
  const { user, profile, loading } = useAuth()
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

  if (requireSuperAdmin && profile?.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }

  if (requireAdmin && !['super_admin', 'admin', 'maintenance_admin'].includes(profile?.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
