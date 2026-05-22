import { useState, useRef, useEffect } from 'react'
import { User, KeyRound, ImagePlus, Eye, EyeOff, MessageSquare, PlayCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

function base64ToBlob(base64) {
  const [header, data] = base64.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
  return new Blob([array], { type: mime })
}

// 自動背景透明化 — 画像の四隅から背景色を検出し、近い色を透明にする
async function removeBackgroundFromImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        // 長辺を最大 600px にリサイズ（egress削減のため）
        const MAX_SIZE = 600
        let { width, height } = img
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width >= height) {
            height = Math.round(height * (MAX_SIZE / width))
            width = MAX_SIZE
          } else {
            width = Math.round(width * (MAX_SIZE / height))
            height = MAX_SIZE
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        const imageData = ctx.getImageData(0, 0, width, height)
        const data = imageData.data

        // STEP 1: 画像の四隅・四辺から背景サンプリング
        // 各辺の中央付近 / 角からピクセルを集めて中央値を計算
        const samplePoints = []
        const inset = 4
        // 四隅
        samplePoints.push([inset, inset])
        samplePoints.push([width - 1 - inset, inset])
        samplePoints.push([inset, height - 1 - inset])
        samplePoints.push([width - 1 - inset, height - 1 - inset])
        // 四辺の中央
        samplePoints.push([Math.floor(width / 2), inset])
        samplePoints.push([Math.floor(width / 2), height - 1 - inset])
        samplePoints.push([inset, Math.floor(height / 2)])
        samplePoints.push([width - 1 - inset, Math.floor(height / 2)])
        const samples = samplePoints.map(([x, y]) => {
          const idx = (y * width + x) * 4
          return [data[idx], data[idx + 1], data[idx + 2]]
        })
        // 平均（簡易）
        const bg = [0, 0, 0]
        samples.forEach(s => { bg[0] += s[0]; bg[1] += s[1]; bg[2] += s[2] })
        bg[0] = Math.round(bg[0] / samples.length)
        bg[1] = Math.round(bg[1] / samples.length)
        bg[2] = Math.round(bg[2] / samples.length)

        // STEP 2: 背景色との色距離で透明化判定
        // 完全透明: 距離 < FULL_TRANSPARENT_DIST
        // 半透明: 距離 FULL〜SEMI で線形補間
        const FULL_TRANSPARENT_DIST = 40
        const SEMI_TRANSPARENT_DIST = 90

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          // ユークリッド距離（RGB空間）
          const dr = r - bg[0]
          const dg = g - bg[1]
          const db = b - bg[2]
          const dist = Math.sqrt(dr * dr + dg * dg + db * db)

          if (dist < FULL_TRANSPARENT_DIST) {
            data[i + 3] = 0
          } else if (dist < SEMI_TRANSPARENT_DIST) {
            const t = (dist - FULL_TRANSPARENT_DIST) / (SEMI_TRANSPARENT_DIST - FULL_TRANSPARENT_DIST)
            data[i + 3] = Math.round(t * 255)
          }
          // else: 不透明のまま
        }

        ctx.putImageData(imageData, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

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

  // profile が遅延ロードされた場合に signPreview を同期
  useEffect(() => {
    if (profile?.signature_url) setSignPreview(profile.signature_url)
  }, [profile?.signature_url])

  // ページを開いた時に DBから最新のサイン画像を直接取得（AuthContextがキャッシュされている場合の保険）
  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('signature_url')
        .eq('id', profile.id)
        .single()
      if (!cancelled && data?.signature_url) {
        setSignPreview(data.signature_url)
      }
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  // 既存のbase64サインをStorageへ自動移行
  useEffect(() => {
    if (profile?.signature_url && profile.signature_url.startsWith('data:') && profile.id) {
      migrateSignatureToStorage(profile.signature_url)
    }
  }, [profile?.id])

  async function migrateSignatureToStorage(base64) {
    try {
      const blob = base64ToBlob(base64)
      const ext = blob.type.includes('png') ? 'png' : 'jpg'
      const filePath = `${profile.id}.${ext}`
      await supabase.storage.createBucket('signatures', { public: true }).catch(() => {})
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(filePath, blob, { contentType: blob.type, upsert: true, cacheControl: '0' })
      if (upErr) return
      const { data: { publicUrl } } = supabase.storage.from('signatures').getPublicUrl(filePath)
      const urlWithBuster = `${publicUrl}?v=${Date.now()}`
      await supabase.from('profiles').update({ signature_url: urlWithBuster }).eq('id', profile.id)
      setSignPreview(urlWithBuster)
    } catch {}
  }

  // Google Chat Webhook
  const [showGuide, setShowGuide] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(profile?.chat_webhook_url || '')
  const [savedWebhookUrl, setSavedWebhookUrl] = useState(profile?.chat_webhook_url || '')
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookTesting, setWebhookTesting] = useState(false)
  const [webhookMsg, setWebhookMsg] = useState('')

  async function handleWebhookSave() {
    setWebhookSaving(true)
    setWebhookMsg('')
    const { error } = await supabase
      .from('profiles')
      .update({ chat_webhook_url: webhookUrl.trim() })
      .eq('id', profile.id)
    setWebhookSaving(false)
    if (error) {
      setWebhookMsg('エラー: ' + error.message)
    } else {
      setSavedWebhookUrl(webhookUrl.trim())
      setWebhookMsg('保存しました')
      setTimeout(() => setWebhookMsg(''), 3000)
    }
  }

  async function handleWebhookTest() {
    const url = savedWebhookUrl || webhookUrl.trim()
    if (!url) { setWebhookMsg('先にURLを保存してください'); return }
    setWebhookTesting(true)
    setWebhookMsg('')
    try {
      const { error } = await supabase.functions.invoke('test-chat-webhook', {
        body: { webhook_url: url },
      })
      if (error) {
        setWebhookMsg('送信失敗: ' + error.message)
      } else {
        setWebhookMsg('テスト送信しました！Google Chatを確認してください')
        setTimeout(() => setWebhookMsg(''), 5000)
      }
    } catch (e) {
      setWebhookMsg('送信失敗: ' + String(e))
    }
    setWebhookTesting(false)
  }

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
    try {
      const blob = base64ToBlob(signBase64)
      const ext = blob.type.includes('png') ? 'png' : 'jpg'
      const filePath = `${profile.id}.${ext}`
      const oppositeExt = ext === 'png' ? 'jpg' : 'png'
      await supabase.storage.createBucket('signatures', { public: true }).catch(() => {})
      // 別拡張子の古いファイルは削除（PNG→JPG など切替時にゴミが残らないように）
      await supabase.storage.from('signatures').remove([`${profile.id}.${oppositeExt}`]).catch(() => {})
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(filePath, blob, { contentType: blob.type, upsert: true, cacheControl: '0' })
      if (upErr) { setSignMsg('エラー: ' + upErr.message); setSignSaving(false); return }
      const { data: { publicUrl } } = supabase.storage.from('signatures').getPublicUrl(filePath)
      // キャッシュバスター：URL末尾にタイムスタンプを付与
      const urlWithBuster = `${publicUrl}?v=${Date.now()}`
      const { error } = await supabase
        .from('profiles')
        .update({ signature_url: urlWithBuster })
        .eq('id', profile.id)
      setSignSaving(false)
      if (error) {
        setSignMsg('エラー: ' + error.message)
      } else {
        setSignPreview(urlWithBuster)
        setSignMsg('サインを保存しました')
        setSignBase64(null)
        setTimeout(() => setSignMsg(''), 3000)
      }
    } catch (e) {
      setSignMsg('エラー: ' + String(e))
      setSignSaving(false)
    }
  }

  function handleSignClear() {
    setSignPreview(null)
    setSignBase64('')
  }

  async function handleSignClearSave() {
    setSignSaving(true)
    setSignMsg('')
    // Storageのファイルも削除
    await supabase.storage.from('signatures').remove([`${profile.id}.png`, `${profile.id}.jpg`]).catch(() => {})
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
                {profile?.role === 'super_admin' ? '特権管理者' : profile?.role === 'admin' ? '管理者' : profile?.role === 'maintenance_admin' ? 'メンテナンス管理者' : '一般'}
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

        {/* ── Google Chat Webhook ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4">
            <MessageSquare size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-700">Google Chat 通知設定</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            承認依頼・結果通知を受け取るGoogle ChatスペースのWebhook URLを登録します。
          </p>

          {/* 設定方法マニュアル動画 */}
          <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowGuide(v => !v)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-sm text-gray-700 font-medium transition-colors"
            >
              <PlayCircle size={16} className="text-blue-500" />
              設定方法のマニュアル動画
              {showGuide ? <ChevronUp size={14} className="ml-auto text-gray-400" /> : <ChevronDown size={14} className="ml-auto text-gray-400" />}
            </button>
            {showGuide && (
              <video
                src="/chat-setup-guide.mp4"
                controls
                className="w-full"
                style={{ maxHeight: '360px' }}
              />
            )}
          </div>

          {/* 現在保存済みのURL */}
          {savedWebhookUrl && (
            <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs text-green-600 font-medium mb-0.5">現在設定済みのURL</p>
              <p className="text-xs text-green-800 break-all font-mono">{savedWebhookUrl}</p>
            </div>
          )}

          <div className="space-y-3">
            <input
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://chat.googleapis.com/v1/spaces/..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleWebhookSave}
                disabled={webhookSaving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {webhookSaving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleWebhookTest}
                disabled={webhookTesting || (!savedWebhookUrl && !webhookUrl.trim())}
                className="px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                {webhookTesting ? '送信中...' : 'テスト送信'}
              </button>
              {webhookMsg && (
                <span className={`text-sm ${webhookMsg.startsWith('エラー') || webhookMsg.startsWith('送信失敗') ? 'text-red-500' : 'text-green-600'}`}>
                  {webhookMsg}
                </span>
              )}
            </div>
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
