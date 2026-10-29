import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// 複製モーダルの「作成者」選択（特権管理者のみ表示）
// value が空なら自分。別ユーザーを選ぶとその人を作成者とした下書きとして複製する
export default function DuplicateCreatorSelect({ value, onChange, disabled }) {
  const { profile, isSuperAdmin } = useAuth()
  const [users, setUsers] = useState([])

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('profiles').select('id, name, status').order('sort_order', { nullsFirst: false })
      .then(({ data }) => setUsers((data || []).filter(u => (u.status || 'active') === 'active')))
  }, [isSuperAdmin])

  if (!isSuperAdmin) return null
  const selected = value || profile?.id

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-600 mb-1">作成者</label>
      <select value={selected} onChange={e => onChange(e.target.value === profile?.id ? '' : e.target.value)} disabled={disabled}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        {users.length === 0 && <option value={profile?.id}>{profile?.name}（自分）</option>}
        {users.map(u => (
          <option key={u.id} value={u.id}>{u.name}{u.id === profile?.id ? '（自分）' : ''}</option>
        ))}
      </select>
      {selected !== profile?.id && (
        <p className="text-[11px] text-amber-600 mt-1">選んだ人を作成者とした下書きとして作成します（元の見積はそのまま残ります）</p>
      )}
    </div>
  )
}
