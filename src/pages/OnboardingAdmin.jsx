import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  Search, X, Download, Edit2, Save, ChevronDown, ChevronUp,
  Loader2, RefreshCw, LogOut, ClipboardList
} from 'lucide-react'

const STATUS_LABELS = {
  submitted: { label: '提出済み', color: 'bg-blue-100 text-blue-700' },
  in_review: { label: '確認中', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: '完了', color: 'bg-green-100 text-green-700' },
}

const GENDER_LABELS = { male: '男性', female: '女性' }
const BOOL_LABELS = { yes: 'あり', no: 'なし' }
const WIDOW_LABELS = { widow: '寡婦', singleParent: 'ひとり親', none: '対象外' }
const COMMUTING_METHOD_LABELS = { train: '電車', bus: 'バス', car: '車', bicycle: '自転車' }

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { label: status, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  )
}

function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-800 break-all">{String(value)}</span>
    </div>
  )
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-4 py-3 space-y-0.5">{children}</div>}
    </div>
  )
}

function FileDownloadButton({ label, path }) {
  const [loading, setLoading] = useState(false)

  async function download() {
    if (!path) return
    setLoading(true)
    try {
      const { data } = await supabase.storage.from('onboarding-files').createSignedUrl(path, 60)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    } finally {
      setLoading(false)
    }
  }

  if (!path) return <span className="text-xs text-gray-400">未アップロード</span>

  return (
    <button
      onClick={download}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-lg transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      {label}
    </button>
  )
}

function ProfilePhotoPreview({ path }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!path) return
    setLoading(true)
    supabase.storage.from('onboarding-files').createSignedUrl(path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
      .finally(() => setLoading(false))
  }, [path])

  if (!path) return <span className="text-xs text-gray-400">未アップロード</span>
  if (loading) return <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
  if (!url) return <span className="text-xs text-red-400">読み込み失敗</span>

  return (
    <div className="flex items-center gap-3">
      <img src={url} alt="プロフィール写真" className="w-24 h-24 rounded-full object-cover border-2 border-gray-200" />
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-lg transition-colors">
        <Download size={13} /> ダウンロード
      </a>
    </div>
  )
}

function DetailModal({ submission, onClose, onUpdate }) {
  const [editMode, setEditMode] = useState(false)
  const [status, setStatus] = useState(submission.status)
  const [adminNotes, setAdminNotes] = useState(submission.admin_notes || '')
  const [saving, setSaving] = useState(false)

  const r = submission
  const fullName = `${r.last_name || ''}${r.first_name || ''}`.trim() || '（名前未入力）'

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('onboarding_submissions')
      .update({ status, admin_notes: adminNotes })
      .eq('id', r.id)
    setSaving(false)
    if (!error) {
      setEditMode(false)
      onUpdate({ ...r, status, admin_notes: adminNotes })
    }
  }

  const family = Array.isArray(r.family_members) ? r.family_members : []
  const emergency = Array.isArray(r.emergency_contacts) ? r.emergency_contacts : []
  const legs = Array.isArray(r.commuting_legs) ? r.commuting_legs : []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-gray-800">{fullName}</h2>
            <p className="text-xs text-gray-500">
              提出: {new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <button
                  onClick={() => { setEditMode(false); setStatus(r.status); setAdminNotes(r.admin_notes || '') }}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-60"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg"
              >
                <Edit2 size={14} />
                編集
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <X size={18} className="text-gray-500" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 w-20">ステータス</span>
              {editMode ? (
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Object.entries(STATUS_LABELS).map(([v, { label }]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={status} />
              )}
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-1">管理者メモ</p>
              {editMode ? (
                <textarea
                  value={adminNotes}
                  onChange={e => setAdminNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="確認事項、備考など..."
                />
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {adminNotes || <span className="text-gray-400">なし</span>}
                </p>
              )}
            </div>
          </div>

          <Section title="書類" defaultOpen>
            <div className="flex flex-col gap-4 pt-1">
              <div>
                <p className="text-xs text-gray-500 mb-2">プロフィール写真</p>
                <ProfilePhotoPreview path={r.profile_photo_path} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">健康診断書</p>
                <FileDownloadButton label="健康診断書をダウンロード" path={r.health_cert_path} />
              </div>
            </div>
          </Section>

          <Section title="基本情報" defaultOpen>
            <InfoRow label="氏名" value={`${r.last_name || ''} ${r.first_name || ''}`.trim()} />
            <InfoRow label="氏名（カナ）" value={`${r.last_name_kana || ''} ${r.first_name_kana || ''}`.trim()} />
            <InfoRow label="入社予定日" value={r.employment_date} />
            <InfoRow label="生年月日" value={r.birth_date} />
            <InfoRow label="性別" value={GENDER_LABELS[r.gender]} />
            <InfoRow label="配偶者" value={BOOL_LABELS[r.has_spouse]} />
            <InfoRow label="寡婦・ひとり親" value={WIDOW_LABELS[r.widow_status]} />
            <InfoRow label="障害" value={BOOL_LABELS[r.has_disability]} />
            <InfoRow label="勤労学生" value={r.is_working_student === 'yes' ? '該当あり' : r.is_working_student === 'no' ? '該当なし' : ''} />
          </Section>

          {r.has_spouse === 'yes' && (
            <Section title="配偶者">
              <InfoRow label="氏名" value={r.spouse_name} />
              <InfoRow label="氏名（フリガナ）" value={r.spouse_name_kana} />
              <InfoRow label="生年月日" value={r.spouse_birth_date} />
              <InfoRow label="性別" value={GENDER_LABELS[r.spouse_gender]} />
              <InfoRow label="職業" value={r.spouse_occupation} />
              <InfoRow label="扶養" value={r.spouse_dependent === 'yes' ? '扶養する' : r.spouse_dependent === 'no' ? '扶養しない' : ''} />
            </Section>
          )}

          <Section title="住所">
            <InfoRow label="住民票 郵便番号" value={r.registered_postal_code} />
            <InfoRow label="住民票 住所" value={`${r.registered_address || ''}${r.registered_address_detail ? ' ' + r.registered_address_detail : ''}`} />
            <InfoRow label="現住所" value={r.same_address ? '住民票住所と同じ' : `${r.current_address || ''}${r.current_address_detail ? ' ' + r.current_address_detail : ''}`} />
            <InfoRow label="世帯主" value={r.household_head} />
            <InfoRow label="続柄" value={r.household_relationship} />
          </Section>

          <Section title={`扶養家族（${family.length}名）`}>
            {family.length === 0 ? (
              <p className="text-sm text-gray-400 py-1">なし</p>
            ) : family.map((m, i) => (
              <div key={i} className="py-2 border-b border-gray-100 last:border-0">
                <p className="text-xs font-medium text-gray-500 mb-1">家族 {i + 1}</p>
                <InfoRow label="氏名" value={m.name} />
                <InfoRow label="氏名（フリガナ）" value={m.nameKana} />
                <InfoRow label="続柄" value={m.relationship} />
                <InfoRow label="生年月日" value={m.birthDate} />
                <InfoRow label="性別" value={GENDER_LABELS[m.gender]} />
                <InfoRow label="職業" value={m.occupation} />
                <InfoRow label="マイナンバー" value={m.myNumber} />
              </div>
            ))}
          </Section>

          <Section title="各種番号">
            <InfoRow label="電話番号" value={r.phone_number} />
            <InfoRow label="メールアドレス" value={r.email} />
            <InfoRow label="控えメール送信" value={r.confirmation_sent_at ? new Date(r.confirmation_sent_at).toLocaleString('ja-JP') : '未送信'} />
            <InfoRow label="雇用保険番号" value={r.employment_insurance_number} />
            <InfoRow label="マイナンバー（本人）" value={r.my_number} />
            <InfoRow label="配偶者マイナンバー" value={r.spouse_my_number} />
            <InfoRow label="基礎年金番号" value={r.basic_pension_number} />
          </Section>

          <Section title="振込口座">
            <InfoRow label="銀行名" value={r.bank_name} />
            <InfoRow label="支店名" value={r.bank_branch_name} />
            <InfoRow label="口座種別" value={r.bank_account_type === 'ordinary' ? '普通' : r.bank_account_type === 'current' ? '当座' : r.bank_account_type} />
            <InfoRow label="口座番号" value={r.bank_account_number} />
            <InfoRow label="口座名義" value={r.bank_account_holder} />
          </Section>

          <Section title="緊急連絡先">
            {emergency.filter(c => c.name || c.relationship).map((c, i) => (
              <div key={i} className="py-2 border-b border-gray-100 last:border-0">
                <p className="text-xs font-medium text-gray-500 mb-1">連絡先 {i + 1}</p>
                <InfoRow label="続柄" value={c.relationship} />
                <InfoRow label="氏名" value={c.name} />
                <InfoRow label="氏名（フリガナ）" value={c.nameKana} />
                <InfoRow label="電話番号" value={c.phone} />
                <InfoRow label="住所" value={c.address} />
                <InfoRow label="メール" value={c.email} />
              </div>
            ))}
          </Section>

          <Section title="秘密保持誓約書">
            <InfoRow label="freeeサイン案内" value={r.freee_sign_notice_acknowledged ? '確認済み' : '未確認'} />
          </Section>

          <Section title="通勤申請">
            <InfoRow label="通勤費申請" value={BOOL_LABELS[r.has_commuting]} />
            {r.has_commuting === 'yes' && (
              <>
                <InfoRow label="通勤先名称" value={r.commuting_destination_name} />
                <InfoRow label="通勤先住所" value={r.commuting_destination_address} />
                {legs.map((leg, i) => (
                  <InfoRow
                    key={i}
                    label={`区間 ${i + 1}`}
                    value={`${COMMUTING_METHOD_LABELS[leg.method] || leg.method}｜${leg.from || ''}→${leg.to || ''}${leg.fare ? '｜' + leg.fare + '円' : ''}`}
                  />
                ))}
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

// ── ログイン画面 ─────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('メールアドレスまたはパスワードが正しくありません')
    } else {
      onLogin()
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <ClipboardList size={22} className="text-blue-600" />
          <h1 className="text-lg font-bold text-gray-800">入社管理</h1>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            ログイン
          </button>
        </form>
      </div>
    </div>
  )
}

// ── 管理画面本体 ─────────────────────────────────────────
function AdminPanel({ user, onLogout }) {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('onboarding_submissions')
      .select('id, created_at, status, last_name, first_name, last_name_kana, first_name_kana, employment_date, health_cert_path, profile_photo_path, admin_notes')
      .order('created_at', { ascending: false })
    if (!error && data) setSubmissions(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])

  async function fetchDetail(id) {
    const { data } = await supabase
      .from('onboarding_submissions')
      .select('*')
      .eq('id', id)
      .single()
    if (data) setSelected(data)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    onLogout()
  }

  const filtered = submissions.filter(s => {
    const name = `${s.last_name || ''}${s.first_name || ''}${s.last_name_kana || ''}${s.first_name_kana || ''}`
    const matchSearch = !search || name.includes(search)
    const matchStatus = statusFilter === 'all' || s.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-blue-600" />
            <span className="font-bold text-gray-800">入社管理</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{user.email}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors"
            >
              <LogOut size={15} />
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800">提出一覧</h1>
            <p className="text-sm text-gray-500 mt-0.5">クリックで詳細確認・編集</p>
          </div>
          <button
            onClick={fetchSubmissions}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
            更新
          </button>
        </div>

        {/* フィルター */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full border border-gray-300 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder="氏名・カナで検索..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {[['all', 'すべて'], ...Object.entries(STATUS_LABELS).map(([v, { label }]) => [v, label])].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  statusFilter === v ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* テーブル */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-gray-400" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
            <ClipboardList size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">該当する提出データがありません</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">氏名</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">入社予定日</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">提出日時</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">書類</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const fullName = `${s.last_name || ''} ${s.first_name || ''}`.trim() || '（名前未入力）'
                    const submittedAt = new Date(s.created_at).toLocaleString('ja-JP', {
                      timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })
                    return (
                      <tr
                        key={s.id}
                        onClick={() => fetchDetail(s.id)}
                        className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-gray-800">{fullName}</td>
                        <td className="px-4 py-3 text-gray-600">{s.employment_date || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{submittedAt}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {s.health_cert_path && <span className="text-xs bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">健診</span>}
                            {s.profile_photo_path && <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">写真</span>}
                            {!s.health_cert_path && !s.profile_photo_path && <span className="text-xs text-gray-400">—</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400">{filtered.length} 件</p>
            </div>
          </div>
        )}
      </main>

      {selected && (
        <DetailModal
          submission={selected}
          onClose={() => setSelected(null)}
          onUpdate={updated => {
            setSelected(updated)
            setSubmissions(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
          }}
        />
      )}
    </div>
  )
}

// ── エントリーポイント ────────────────────────────────────
export default function OnboardingAdmin() {
  const [user, setUser] = useState(undefined) // undefined = 確認中

  useEffect(() => {
    document.title = '入社管理'
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={28} />
      </div>
    )
  }

  if (!user) return <LoginScreen onLogin={() => {}} />

  return <AdminPanel user={user} onLogout={() => setUser(null)} />
}
