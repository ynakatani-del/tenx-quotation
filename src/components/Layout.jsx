import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  FileText, Users, Building2, UserCog, List, BarChart3,
  LogOut, Menu, X, ChevronRight, Settings
} from 'lucide-react'

const navItems = [
  { path: '/quotations', label: '見積一覧', icon: FileText, roles: ['super_admin', 'admin', 'general'] },
  { path: '/customers', label: '顧客管理', icon: Users, roles: ['super_admin', 'admin'] },
  { path: '/users', label: 'ユーザー管理', icon: UserCog, roles: ['super_admin'] },
  { path: '/companies', label: '発行会社管理', icon: Building2, roles: ['super_admin', 'admin'] },
  { path: '/unit-prices', label: '登録単価表', icon: List, roles: ['super_admin', 'admin', 'general'] },
  { path: '/aggregation', label: '集計', icon: BarChart3, roles: ['super_admin', 'admin', 'general'] },
  { path: '/settings', label: '税率設定', icon: Settings, roles: ['super_admin'] },
]

export default function Layout({ children }) {
  const { profile, signOut, isSuperAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visibleNav = navItems.filter(item => item.roles.includes(profile?.role))

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-40 print:hidden">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded hover:bg-gray-100 md:hidden"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <Link to="/dashboard" className="text-lg font-semibold text-blue-700 tracking-wide">
              Xcom RFQ
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {profile?.name}
              <span className="ml-2 text-xs text-gray-400">
                ({profile?.role === 'super_admin' ? '特権管理者' : profile?.role === 'admin' ? '管理者' : '一般'})
              </span>
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-500 transition-colors"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">ログアウト</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 pt-14 print:pt-0">
        {/* Sidebar */}
        <aside className={`
          fixed top-14 left-0 bottom-0 w-56 bg-white border-r border-gray-200 z-30
          transform transition-transform duration-200 print:hidden
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}>
          <nav className="p-3 space-y-1">
            {visibleNav.map(({ path, label, icon: Icon }) => {
              const active = location.pathname.startsWith(path)
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                    ${active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon size={18} />
                  {label}
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 md:ml-56 p-6 min-w-0 print:ml-0 print:p-0">
          {children}
        </main>
      </div>
    </div>
  )
}
