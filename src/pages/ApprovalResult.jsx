import { useSearchParams, useNavigate } from 'react-router-dom'

const RESULTS = {
  approve:          { icon: '✓', color: 'green', title: '承認しました',     msg: '見積の承認が完了しました。' },
  reject:           { icon: '↩', color: 'red',   title: '差し戻しました',   msg: '見積の差し戻しが完了しました。' },
  already_approved: { icon: '✓', color: 'gray',  title: '既に承認済みです', msg: 'この見積はすでに承認されています。' },
  already_rejected: { icon: '↩', color: 'gray',  title: '差し戻し済みです', msg: 'この見積はすでに差し戻されています。' },
  already:          { icon: '!', color: 'gray',  title: '処理済みです',     msg: 'この見積はすでに処理されています。' },
  error:            { icon: '!', color: 'gray',  title: 'エラー',           msg: '無効なリンクです。' },
}

const COLOR = {
  green: { bg: 'bg-green-100', text: 'text-green-600', h1: 'text-green-700' },
  red:   { bg: 'bg-red-100',   text: 'text-red-600',   h1: 'text-red-600' },
  gray:  { bg: 'bg-gray-100',  text: 'text-gray-500',  h1: 'text-gray-700' },
}

export default function ApprovalResult() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const action = searchParams.get('action') || 'error'
  const quotationId = searchParams.get('quotation_id')
  const r = RESULTS[action] || RESULTS.error
  const c = COLOR[r.color]

  const handleLogin = () => {
    if (quotationId) {
      navigate(`/quotations/${quotationId}/edit`)
    } else {
      navigate('/login')
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-12 text-center max-w-sm w-full">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-bold ${c.bg} ${c.text}`}>
          {r.icon}
        </div>
        <h1 className={`text-2xl font-bold mb-3 ${c.h1}`}>{r.title}</h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-8">{r.msg}</p>
        <button
          onClick={handleLogin}
          className="w-full bg-blue-700 text-white py-3.5 rounded-xl text-sm font-semibold hover:bg-blue-800 transition-colors mb-3"
        >
          {quotationId ? '見積書を確認する' : 'ログインする'}
        </button>
        <button
          onClick={() => window.close()}
          className="w-full bg-gray-100 text-gray-600 py-3.5 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors"
        >
          画面を閉じる
        </button>
      </div>
    </div>
  )
}
