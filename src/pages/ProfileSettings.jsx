import { useState, useRef } from 'react'
import { User, KeyRound, ImagePlus, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function ProfileSettings() {
  const { profile, user } = useAuth()

  // サイン
  const [signPreview, setSignPreview] = useState(profile?.signature_url || null)
  const [signBase64, setSignBase64] = useState(null)
  const [signSaving, setSignSaving] = useState(false)
  const [signMsg, setSignMsg] = useState('')
  const signInputRef = useRef(null)

  // パスワード
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  function handleSignFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setSignPreview(ev.target.result)
      setSignBase64(ev.target.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleSignSave() {
    if (!signBase64) return
    setSignSaving(true)
    setSignMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({ signature_url: signBase64 })
      .eq('id', profile.id)
    setSignSaving(false)
    if (error) {
      setSignMsg('エラー: ' + error.message)
    } else {
      setSignMsg('サインを保存しました')
      setSignBase64(null)
      setTimeout(() => setSignMsg(''), 3000)
    }
  }

  function handleSignClear() {
    setSignPreview(null)
    setSignBase64('')
  }

  async function handleSignClearSave() {
    setSignSaving(true)
    setSignMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({ signature_url: null })
      .eq('id', profile.id)
    setSignSaving(false)
    if (error) {
      setSignMsg('エラー: ' + error.message)
    } else {
      setSignPreview(null)
      setSignBase64(null)
      setSignMsg('サインを削除しました')
      setTimeout(() => setSignMsg(''), 3000)
    }
  }

  async function handlePasswordChange() {
    setPwMsg('')
    if (!newPassword || newPassword.length < 6) {
      setPwMsg('新しいパスワードは6文字以上で入力してください')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwMsg('新しいパスワードと確認が一致しません')
      return
    }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwSaving(false)
    if (error) {
      setPwMsg('エラー: ' + error.message)
    } else {
      setPwMsg('パスワードを変更しました')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPwMsg(''), 4000)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">個人設定</h1>

      <div className="space-y-6">
        {/* ── プロフィール情報 ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
            <User size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-700">アカウント情報</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-gray-400 w-24">氏名</span>
              <span className="text-gray-800 font-medium">{profile?.name}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-gray-400 w-24">メール</span>
              <span className="text-gray-800">{user?.email}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-gray-400 w-24">権限</span>
              <span className="text-gray-800">
                {profile?.role === 'super_admin' ? '特権管理者' : profile?.role === 'admin' ? '管理者' : '一般'}
              </span>
            </div>
          </div>
        </div>

        {/* ── サイン登録 ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
            <ImagePlus size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-700">サイン画像</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            登録したサイン画像は見積書の担当者欄・承認者欄に表示されます。<br />
            白背景で署名した画像（PNG/JPG）を推奨します。
          </p>

          {/* プレビューエリア */}
          <div
            className="border-2 border-dashed border-gray-200 rounded-xl h-28 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors mb-3"
            onClick={() => signInputRef.current?.click()}
          >
            {signPreview ? (
              <img src={signPreview} alt="サインプレビュー" className="max-h-20 max-w-full object-contain" />
            ) : (
              <div className="text-center">
                <ImagePlus size={24} className="text-gray-300 mx-auto mb-1" />
                <p className="text-xs text-gray-400">クリックして画像を選択</p>
              </div>
            )}
          </div>
          <input ref={signInputRef} type="file" accept="image/*" className="hidden" onChange={handleSignFile} />

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => signInputRef.current?.click()}
              className="px-3 py-1.5 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
            >
              画像を選択
            </button>
            {signBase64 !== null && signBase64 !== '' && (
              <button
                onClick={handleSignSave}
                disabled={signSaving}
                className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {signSaving ? '保存中...' : '保存'}
              </button>
            )}
            {(signPreview || profile?.signature_url) && (
              <button
                onClick={handleSignClearSave}
                disabled={signSaving}
                className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                削除
              </button>
            )}
            {signMsg && (
              <span className={`text-sm ${signMsg.startsWith('エラー') ? 'text-red-500' : 'text-green-600'}`}>
                {signMsg}
              </span>
            )}
          </div>
        </div>

        {/* ── パスワード変更 ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
            <KeyRound size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-700">パスワード変更</h2>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード</label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="6文字以上"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                >
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード（確認）</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="もう一度入力"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handlePasswordChange}
                disabled={pwSaving || !newPassword || !confirmPassword}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {pwSaving ? '変更中...' : 'パスワードを変更'}
              </button>
              {pwMsg && (
                <span className={`text-sm ${pwMsg.startsWith('エラー') ? 'text-red-500' : 'text-green-600'}`}>
                  {pwMsg}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
