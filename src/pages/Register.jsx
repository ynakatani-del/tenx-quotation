import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { COMPANY_EMAIL_GUIDANCE, isCompanyEmail, normalizeCompanyEmail } from '../lib/companyEmail'

const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]{1,99}$/

export default function Register() {
  const [form, setForm] = useState({
    email: '',
    name: '',
    phone: '',
    password: '',
    passwordConfirm: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState(false)

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    const email = normalizeCompanyEmail(form.email)
    const name = form.name.trim()
    if (!isCompanyEmail(email)) {
      setError(COMPANY_EMAIL_GUIDANCE)
      return
    }
    if (!NAME_PATTERN.test(name)) {
      setError('氏名はローマ字で入力してください（例: Yutaka Nakatani）。')
      return
    }
    if (form.password.length < 8) {
      setError('パスワードは8文字以上で入力してください。')
      return
    }
    if (form.password !== form.passwordConfirm) {
      setError('確認用パスワードが一致しません。')
      return
    }

    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('register-account', {
      body: {
        email,
        name,
        phone: form.phone.trim(),
        password: form.password,
      },
    })
    setSubmitting(false)

    if (invokeError || data?.error) {
      let message = data?.error || ''
      if (!message && invokeError?.context) {
        try {
          const errorBody = await invokeError.context.json()
          message = errorBody?.error || ''
        } catch {
          // レスポンス本文を読めない通信エラーでは、下の案内を表示する。
        }
      }
      setError(message || '登録申請機能へ接続できませんでした。時間をおいて再度お試しください。')
      return
    }
    setCompleted(true)
  }

  if (completed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8 text-center">
          <CheckCircle2 size={42} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-xl font-bold text-gray-800">登録申請を受け付けました</h1>
          <p className="text-sm leading-relaxed text-gray-500 mt-3">
            yutaka nakataniへ承認依頼を送信しました。承認が完了するまでログインできません。
          </p>
          <Link to="/login" className="inline-flex mt-6 px-5 py-2.5 rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700">
            ログイン画面へ戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        <div className="text-center mb-6">
          <UserPlus size={32} className="mx-auto text-blue-600 mb-2" />
          <h1 className="text-2xl font-bold text-blue-700">新規登録</h1>
          <p className="text-sm text-gray-500 mt-1">10X・Three-side 社内アプリ 共通アカウント</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="メールアドレス *">
            <input type="email" required autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@tenx.jp / name@three-side.jp" className={inputClass} />
          </Field>
          <Field label="氏名（ローマ字） *" hint="例: Yutaka Nakatani">
            <input required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Yutaka Nakatani" className={inputClass} />
          </Field>
          <Field label="個人電話番号" hint="例: +81-90-1234-5678">
            <input type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+81-90-1234-5678" className={inputClass} />
          </Field>
          <Field label="パスワード *" hint="8文字以上">
            <input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputClass} />
          </Field>
          <Field label="パスワード（確認） *">
            <input type="password" required minLength={8} autoComplete="new-password" value={form.passwordConfirm} onChange={(e) => set('passwordConfirm', e.target.value)} className={inputClass} />
          </Field>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <p className="text-xs leading-relaxed text-gray-500 bg-gray-50 rounded-lg p-3">
            申請後、管理者が所属オフィス・役職・利用権限を設定して承認します。
          </p>
          <button type="submit" disabled={submitting} className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {submitting ? '申請中...' : '登録を申請する'}
          </button>
          <Link to="/login" className="block text-center text-sm text-gray-500 hover:text-blue-600">ログイン画面へ戻る</Link>
        </form>
      </div>
    </div>
  )
}

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
