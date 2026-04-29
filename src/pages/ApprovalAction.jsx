import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ApprovalAction() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')
  const action = searchParams.get('action')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isApprove = action === 'approve'

  if (!token || !['approve', 'reject'].includes(action || '')) {
    navigate('/dashboard/approval-result?action=error')
    return null
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('process-approval', {
        body: { token, action, comment },
      })
      if (fnErr) throw fnErr
      if (data?.error === 'already_approved') {
        navigate('/dashboard/approval-result?action=already_approved')
      } else if (data?.error === 'already_rejected') {
        navigate('/dashboard/approval-result?action=already_rejected')
      } else if (data?.error) {
        navigate('/dashboard/approval-result?action=error')
      } else {
        const qid = data?.quotation_id ? `&quotation_id=${data.quotation_id}` : ''
        navigate(`/dashboard/approval-result?action=${action}${qid}`)
      }
    } catch {
      setError('処理に失敗しました。時間をおいて再度お試しください。')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-10 text-center max-w-sm w-full">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl font-bold ${isApprove ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
          {isApprove ? '✓' : '↩'}
        </div>
        <h1 className={`text-2xl font-bold mb-2 ${isApprove ? 'text-green-700' : 'text-red-600'}`}>
          {isApprove ? '見積を承認しますか？' : '見積を差し戻しますか？'}
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          {isApprove ? '承認すると申請者に通知されます。' : '差し戻すと申請者に通知されます。'}
        </p>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="コメント（任意）"
          rows={3}
          className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 resize-none mb-5 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`w-full text-white py-3.5 rounded-xl text-sm font-semibold transition-colors mb-3 disabled:opacity-50 ${isApprove ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
        >
          {loading ? '処理中...' : isApprove ? '承認する' : '差し戻す'}
        </button>
        <button
          onClick={() => window.close()}
          className="w-full bg-gray-100 text-gray-600 py-3.5 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-colors"
        >
          キャンセル
        </button>
      </div>
    </div>
  )
}
