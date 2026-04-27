import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { FileText, Users, Building2, UserCog, List, BarChart3, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'

const menuItems = [
  { path: '/quotations', label: '見積一覧', icon: FileText, roles: ['super_admin', 'admin', 'general'] },
  { path: '/customers', label: '顧客管理', icon: Users, roles: ['super_admin', 'admin'] },
  { path: '/users', label: 'ユーザー管理', icon: UserCog, roles: ['super_admin'] },
  { path: '/companies', label: '発行会社管理', icon: Building2, roles: ['super_admin', 'admin'] },
  { path: '/unit-prices', label: '登録単価表', icon: List, roles: ['super_admin', 'admin', 'general'] },
  { path: '/aggregation', label: '集計', icon: BarChart3, roles: ['super_admin', 'admin', 'general'] },
  { path: '/settings', label: '税率設定', icon: Settings, roles: ['super_admin'] },
]

export default function Dashboard() {
  const { profile } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const isApprover = profile?.role === 'super_admin' || profile?.role === 'admin'

  useEffect(() => {
    if (!isApprover) return
    supabase
      .from('quotations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval')
      .then(({ count }) => setPendingCount(count || 0))
  }, [isApprover])

  const visible = menuItems.filter(item => item.roles.includes(profile?.role))

  return (
    <div className="max-w-md mx-auto py-12">
      <h2 className="text-center text-gray-500 text-sm mb-8">トップメニュー</h2>

      {isApprover && pendingCount > 0 && (
        <Link to="/quotations?filter=pending_approval" className="block mb-6">
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-center">
            <p className="text-red-600 font-semibold text-sm">
              承認待ちが <span className="text-xl font-bold">{pendingCount}</span> 件あります
            </p>
          </div>
        </Link>
      )}

      <div className="space-y-3">
        {visible.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className="flex items-center justify-center gap-3 w-full border border-blue-300 text-blue-600 rounded-lg py-3 text-sm font-medium hover:bg-blue-50 transition-colors"
          >
            <Icon size={18} />
            {label}
            {label === '見積一覧' && isApprover && pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                {pendingCount}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
