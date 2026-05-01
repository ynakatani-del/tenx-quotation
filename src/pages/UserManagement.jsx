import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Upload, X, Eye, EyeOff, GripVertical } from 'lucide-react'
import { useDragAutoScroll } from '../hooks/useDragAutoScroll'

const ROLE_LABELS = {
  super_admin: { label: '特権管理者', color: 'bg-purple-100 text-purple-700' },
  admin: { label: '管理者', color: 'bg-blue-100 text-blue-700' },
  general: { label: '一般', color: 'bg-gray-100 text-gray-600' },
}

const STATUS_LABELS = {
  active:    { label: '有効',     color: 'bg-green-100 text-green-700' },
  suspended: { label: '停止中',   color: 'bg-yellow-100 text-yellow-700' },
  deleted:   { label: '削除済み', color: 'bg-red-100 text-red-500' },
}

export default function UserManagement() {
  const { profile: myProfile, isSuperAdmin } = useAuth()
  useDragAutoScroll()
  const [users, setUsers] = useState([])
  const [editUser, setEditUser] = useState(null)
  const [newRole, setNewRole] = useState('general')
  const [newName, setNewName] = useState('')
  const [signPreview, setSignPreview] = useState(null)
  const [signBase64, setSignBase64] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [avatarBase64, setAvatarBase64] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const signInputRef = useRef(null)
  const avatarInputRef = useRef(null)

  // パスワード変更
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  // 停止・削除
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [inviteModal, setInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('general')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data } = await supabase.from('profiles').select('*').order('sort_order', { nullsFirst: false }).order('created_at')
    setUsers(data || [])
  }

  const [dragUserId, setDragUserId] = useState(null)
  const [dragUserOverId, setDragUserOverId] = useState(null)

  async function handleUserDrop(targetId) {
    if (!dragUserId || dragUserId === targetId) return
    const arr = [...users]
    const fromIdx = arr.findIndex(u => u.id === dragUserId)
    const toIdx   = arr.findIndex(u => u.id === targetId)
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
    const newArr = arr.map((u, i) => ({ ...u, sort_order: (i + 1) * 10 }))
    setUsers(newArr)
    setDragUserId(null)
    setDragUserOverId(null)
    await Promise.all(newArr.map(u =>
      supabase.from('profiles').update({ sort_order: u.sort_order }).eq('id', u.id)
    ))
  }

  function openEdit(u) {
    if ((u.status || 'active') === 'deleted') return
    setEditUser(u)
    setNewRole(u.role)
    setNewName(u.name || '')
    setSignPreview(u.signature_url || null)
    setSignBase64(null)
    setAvatarPreview(u.avatar_url || null)
    setAvatarBase64(null)
    setSaveMsg('')
    setNewPassword('')
    setPwMsg('')
    setShowPassword(false)
    setActionMsg('')
    setConfirmDelete(false)
  }

  function handleFileChange(e, setPreview, setBase64) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setPreview(ev.target.result)
      setBase64(ev.target.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleSave() {
    if (!editUser) return
    setSaving(true)
    setSaveMsg('')

    const updates = { role: newRole, name: newName }
    if (signBase64 !== null) updates.signature_url = signBase64
    if (avatarBase64 !== null) updates.avatar_url = avatarBase64

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', editUser.id)

    setSaving(false)
    if (error) {
      setSaveMsg('エラー: ' + error.message)
    } else {
      setSaveMsg('保存しました')
      fetchUsers()
      setTimeout(() => { setEditUser(null); setSaveMsg('') }, 800)
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      setPwMsg('6文字以上のパスワードを入力してください')
      return
    }
    setPwSaving(true)
    setPwMsg('')
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('admin-user-action', {
      body: { action: 'change-password', userId: editUser.id, password: newPassword },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    setPwSaving(false)
    if (error || data?.error) {
      setPwMsg('エラー: ' + (data?.error || error?.message))
    } else {
      setPwMsg('パスワードを変更しました')
      setNewPassword('')
    }
  }

  async function handleAdminAction(action) {
    setActionLoading(true)
    setActionMsg('')
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('admin-user-action', {
      body: { action, userId: editUser.id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    setActionLoading(false)
    if (error || data?.error) {
      setActionMsg('エラー: ' + (data?.error || error?.message))
    } else {
      await fetchUsers()
      setEditUser(null)
    }
  }

  async function handleInvite() {
    setInviting(true)
    setInviteMsg('')
    const { error: signUpError } = await supabase.auth.signUp({
      email: inviteEmail,
      password: invitePassword,
      options: { data: { name: inviteName, role: inviteRole } }
    })
    setInviting(false)
    if (signUpError) {
      setInviteMsg('エラー: ' + signUpError.message)
    } else {
      setInviteMsg('ユーザーを作成しました。')
      setInviteModal(false)
      setInviteEmail(''); setInviteName(''); setInvitePassword(''); setInviteRole('general')
      fetchUsers()
    }
  }

  // 特権管理者が操作可能か（自分・他の特権管理者・削除済みは不可）
  function canAdminOperate(u) {
    return isSuperAdmin
      && u.id !== myProfile?.id
      && u.role !== 'super_admin'
      && (u.status || 'active') !== 'deleted'
  }

  function UploadArea({ preview, onClear, onClickArea, label, round }) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <div
          className={`border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 bg-gray-50 relative ${round ? 'rounded-full w-24 h-24 mx-auto' : 'rounded-lg h-24'}`}
          onClick={onClickArea}
        >
          {preview ? (
            <img
              src={preview}
              alt={label}
              className={`object-cover ${round ? 'w-24 h-24 rounded-full' : 'max-h-20 max-w-full object-contain p-2'}`}
            />
          ) : (
            <div className="text-center text-gray-400 pointer-events-none">
              <Upload size={20} className="mx-auto mb-1" />
              <p className="text-xs">クリックして選択</p>
            </div>
          )}
        </div>
        {preview && (
          <button onClick={onClear} className="mt-1.5 text-xs text-red-500 hover:text-red-700 block mx-auto">
            削除
          </button>
        )}
      </div>
    )
  }

  const isSuspended = (u) => (u.status || 'active') === 'suspended'
  const isDeleted = (u) => (u.status || 'active') === 'deleted'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-800">ユーザー管理</h1>
        <button
          onClick={() => setInviteModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> ユーザー追加
        </button>
      </div>

      {inviteMsg && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">{inviteMsg}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {isSuperAdmin && <th className="w-8"></th>}
              <th className="px-4 py-3 text-left text-xs text-gray-500">顔写真</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500">名前</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500">メールアドレス</th>
              <th className="px-4 py-3 text-center text-xs text-gray-500">権限</th>
              <th className="px-4 py-3 text-center text-xs text-gray-500">状態</th>
              <th className="px-4 py-3 text-center text-xs text-gray-500">サイン</th>
              <th className="px-4 py-3 text-left text-xs text-gray-500">登録日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => {
              const role = ROLE_LABELS[u.role] || ROLE_LABELS.general
              const statusKey = u.status || 'active'
              const statusLabel = STATUS_LABELS[statusKey] || STATUS_LABELS.active
              const deleted = isDeleted(u)
              const isDragging = dragUserId === u.id
              const isOver    = dragUserOverId === u.id && dragUserId !== u.id
              return (
                <tr
                  key={u.id}
                  draggable={isSuperAdmin && !deleted}
                  onDragStart={() => isSuperAdmin && !deleted && setDragUserId(u.id)}
                  onDragEnd={() => { setDragUserId(null); setDragUserOverId(null) }}
                  onDragOver={e => { e.preventDefault(); isSuperAdmin && !deleted && setDragUserOverId(u.id) }}
                  onDrop={() => isSuperAdmin && handleUserDrop(u.id)}
                  className={`transition-colors
                    ${deleted ? 'opacity-40 cursor-default' : 'hover:bg-blue-50 cursor-pointer'}
                    ${isDragging ? 'opacity-40' : ''}
                    ${isOver ? 'border-t-2 border-blue-500' : ''}
                  `}
                  onClick={() => !deleted && openEdit(u)}
                >
                  {isSuperAdmin && (
                    <td className="pl-2 pr-0 py-3 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                      <GripVertical size={16} className="text-gray-400 mx-auto" />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="顔写真" className="w-9 h-9 rounded-full object-cover mx-auto" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center mx-auto">
                        <span className="text-xs text-gray-400">{(u.name || '?')[0]}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-blue-700 underline underline-offset-2">
                    {u.name}
                    {u.id === myProfile?.id && <span className="ml-2 text-xs text-gray-400 no-underline">(自分)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${role.color}`}>{role.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusLabel.color}`}>{statusLabel.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.signature_url ? (
                      <img src={u.signature_url} alt="サイン" className="h-7 max-w-[80px] object-contain mx-auto" />
                    ) : (
                      <span className="text-xs text-gray-400">未登録</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(u.created_at).toLocaleDateString('ja-JP')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ユーザー編集モーダル */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-800">ユーザー編集</h3>
              <button onClick={() => setEditUser(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* 顔写真 */}
              <UploadArea
                preview={avatarPreview}
                onClear={() => { setAvatarPreview(null); setAvatarBase64('') }}
                onClickArea={() => avatarInputRef.current?.click()}
                label="顔写真"
                round={true}
              />
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFileChange(e, setAvatarPreview, setAvatarBase64)} />

              {/* 名前 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">名前</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* 権限 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">権限</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="general">一般</option>
                  <option value="admin">管理者</option>
                  <option value="super_admin">特権管理者</option>
                </select>
              </div>

              {/* サイン */}
              <UploadArea
                preview={signPreview}
                onClear={() => { setSignPreview(null); setSignBase64('') }}
                onClickArea={() => signInputRef.current?.click()}
                label="サイン（透過PNG推奨）"
                round={false}
              />
              <input ref={signInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFileChange(e, setSignPreview, setSignBase64)} />
            </div>

            {saveMsg && (
              <div className={`mt-3 text-xs px-3 py-2 rounded ${saveMsg.startsWith('エラー') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {saveMsg}
              </div>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setEditUser(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
                キャンセル
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>

            {/* 特権管理者専用操作エリア */}
            {canAdminOperate(editUser) && (
              <div className="mt-6 border-t border-gray-200 pt-5 space-y-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">管理者操作</p>

                {/* パスワード変更 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">パスワード変更</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="新しいパスワード（6文字以上）"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <button
                      onClick={handleChangePassword}
                      disabled={pwSaving || !newPassword}
                      className="px-3 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {pwSaving ? '変更中...' : '変更'}
                    </button>
                  </div>
                  {pwMsg && (
                    <p className={`mt-1 text-xs ${pwMsg.startsWith('エラー') ? 'text-red-500' : 'text-green-600'}`}>{pwMsg}</p>
                  )}
                </div>

                {/* 停止 / 再開 */}
                <div>
                  {isSuspended(editUser) ? (
                    <button
                      onClick={() => handleAdminAction('unsuspend')}
                      disabled={actionLoading}
                      className="w-full py-2 text-sm text-yellow-700 border border-yellow-400 rounded-lg hover:bg-yellow-50 disabled:opacity-50"
                    >
                      {actionLoading ? '処理中...' : '一時停止を解除する'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAdminAction('suspend')}
                      disabled={actionLoading}
                      className="w-full py-2 text-sm text-yellow-700 border border-yellow-400 rounded-lg hover:bg-yellow-50 disabled:opacity-50"
                    >
                      {actionLoading ? '処理中...' : 'ユーザーを一時停止する'}
                    </button>
                  )}
                </div>

                {/* 削除 */}
                <div>
                  {!confirmDelete ? (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="w-full py-2 text-sm text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
                    >
                      ユーザーを削除する
                    </button>
                  ) : (
                    <div className="border border-red-300 rounded-lg p-3 bg-red-50">
                      <p className="text-xs text-red-700 mb-3">削除するとログインできなくなります。この操作は取り消せません。</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className="flex-1 py-2 text-xs text-gray-600 border border-gray-300 rounded-lg bg-white"
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={() => handleAdminAction('delete')}
                          disabled={actionLoading}
                          className="flex-1 py-2 text-xs text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          {actionLoading ? '削除中...' : '削除する'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {actionMsg && (
                  <p className="text-xs text-red-500">{actionMsg}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ユーザー招待モーダル */}
      {inviteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">新規ユーザー追加</h3>
              <button onClick={() => setInviteModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">名前 *</label>
                <input value={inviteName} onChange={e => setInviteName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">メールアドレス *</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">初期パスワード *</label>
                <input type="password" value={invitePassword} onChange={e => setInvitePassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">権限</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="general">一般</option>
                  <option value="admin">管理者</option>
                  <option value="super_admin">特権管理者</option>
                </select>
              </div>
            </div>
            {inviteMsg && (
              <div className="mt-3 text-xs px-3 py-2 rounded bg-red-50 text-red-600">{inviteMsg}</div>
            )}
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setInviteModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
              <button onClick={handleInvite} disabled={inviting || !inviteEmail || !inviteName || !invitePassword}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {inviting ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
