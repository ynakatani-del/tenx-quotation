import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, FileText, Printer, CheckCircle, XCircle, Copy, FileEdit, Trash2, SlidersHorizontal } from 'lucide-react'

const STATUS_LABELS = {
  draft: { label: '下書き', color: 'bg-gray-100 text-gray-600' },
  pending_approval: { label: '承認待ち', color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: '承認済み', color: 'bg-green-100 text-green-700' },
  rejected: { label: '差し戻し', color: 'bg-red-100 text-red-700' },
}

export default function QuotationList() {
  const navigate = useNavigate()
  const { profile, isAdmin, isSuperAdmin, isApprover } = useAuth()
  const [quotations, setQuotations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showOldRevisions, setShowOldRevisions] = useState(false)
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterCreator, setFilterCreator] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [rejectModal, setRejectModal] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [duplicateModal, setDuplicateModal] = useState(null)
  const [duplicating, setDuplicating] = useState(false)
  const [deleteModal, setDeleteModal] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [profileMap, setProfileMap] = useState({})
  const [showOnlyMine, setShowOnlyMine] = useState(false)

  useEffect(() => {
    fetchQuotations()

    const channel = supabase
      .channel('quotations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, () => {
        fetchQuotations()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchQuotations() {
    setLoading(true)
    const { data } = await supabase
      .from('quotations')
      .select(`*, customers(name), companies(name), profiles!quotations_created_by_fkey(name), customer_name`)
      .order('created_at', { ascending: false })
    const rows = data || []
    setQuotations(rows)

    const ids = [...new Set(
      rows.flatMap(q => [q.requested_approver_id, q.approved_by]).filter(Boolean)
    )]
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', ids)
      const map = {}
      for (const p of profiles || []) map[p.id] = p.name
      setProfileMap(map)
    }

    setLoading(false)
  }

  const customerOptions = [...new Set(quotations.map(q => q.customers?.name || q.customer_name).filter(Boolean))].sort()
  const companyOptions = [...new Set(quotations.map(q => q.companies?.name).filter(Boolean))].sort()
  const creatorOptions = [...new Set(quotations.map(q => q.profiles?.name).filter(Boolean))].sort()

  const filtered = quotations.filter(q => {
    const customerName = q.customers?.name || q.customer_name || ''
    if (filter !== 'all' && q.status !== filter) return false
    if (search) {
      const s = search.toLowerCase()
      const hit = q.title?.toLowerCase().includes(s) ||
        q.quotation_number?.toLowerCase().includes(s) ||
        customerName.toLowerCase().includes(s)
      if (!hit) return false
    }
    if (filterCustomer && customerName !== filterCustomer) return false
    if (filterCompany && q.companies?.name !== filterCompany) return false
    if (filterCreator && q.profiles?.name !== filterCreator) return false
    if (filterDateFrom && q.issue_date < filterDateFrom) return false
    if (filterDateTo && q.issue_date > filterDateTo) return false
    if (!showOldRevisions && q.is_latest_revision === false) return false
    if (showOnlyMine && q.created_by !== profile?.id) return false
    return true
  })

  const activeFilterCount = [filterCustomer, filterCompany, filterCreator, filterDateFrom, filterDateTo].filter(Boolean).length

  function clearFilters() {
    setFilterCustomer(''); setFilterCompany(''); setFilterCreator('')
    setFilterDateFrom(''); setFilterDateTo('')
  }

  async function handleApprove(q) {
    await supabase
      .from('quotations')
      .update({ status: 'approved', approved_by: profile.id, approved_at: new Date().toISOString() })
      .eq('id', q.id)
    supabase.functions.invoke('notify-requester', {
      body: { quotation_id: q.id, action: 'approve', approver_id: profile.id },
    }).catch(e => console.error('notify-requester error:', e))
    fetchQuotations()
  }

  async function handleDelete() {
    const targetId = deleteModal?.id
    if (!targetId) return
    setDeleting(true)
    try {
      await supabase.from('quotations').update({ source_quotation_id: null }).eq('source_quotation_id', targetId)
      await supabase.from('quotation_items').delete().eq('quotation_id', targetId)
      // 特権管理者は承認済みも含めて削除可能。それ以外は draft/rejected のみ。
      const query = supabase.from('quotations').delete().eq('id', targetId)
      const { error: qErr, data: deleted } = await (
        isSuperAdmin
          ? query.select('id')
          : query.in('status', ['draft', 'rejected']).select('id')
      )
      if (qErr) throw new Error(qErr.message)
      if (!deleted || deleted.length === 0) throw new Error('対象の見積が見つかりません')
      setDeleteModal(null)
      fetchQuotations()
    } catch (err) {
      alert(`削除に失敗しました。\n${err.message}`)
    } finally {
      setDeleting(false)
    }
  }

  // 削除ボタン表示可否: draft/rejected は誰でも、承認待ち/承認済みは特権管理者のみ
  function canDelete(q) {
    if (q.status === 'draft' || q.status === 'rejected') return true
    return isSuperAdmin
  }

  async function handleReject() {
    await supabase.from('quotations')
      .update({ status: 'rejected', rejection_reason: rejectReason })
      .eq('id', rejectModal.id)
    supabase.functions.invoke('notify-requester', {
      body: { quotation_id: rejectModal.id, action: 'reject', comment: rejectReason, approver_id: profile.id },
    }).catch(e => console.error('notify-requester error:', e))
    setRejectModal(null)
    setRejectReason('')
    fetchQuotations()
  }

  function handlePrint(q) {
    navigate(`/quotations/${q.id}/print`)
  }

  async function handleDuplicate(mode) {
    const q = duplicateModal
    setDuplicating(true)
    try {
      const { data: source } = await supabase
        .from('quotations').select('*, quotation_items(*)').eq('id', q.id).single()

      let newBaseNumber, newRevisionNumber, newQuotationNumber

      if (mode === 'revision') {
        const srcBase = source.base_number || source.quotation_number
        const { data: revisions } = await supabase
          .from('quotations').select('revision_number').eq('base_number', srcBase)
        const maxRev = Math.max(...(revisions || []).map(r => r.revision_number || 1), 1)
        newBaseNumber = srcBase
        newRevisionNumber = maxRev + 1
        newQuotationNumber = `${newBaseNumber}-${newRevisionNumber}`
        await supabase.from('quotations').update({ is_latest_revision: false })
          .eq('base_number', srcBase).eq('is_latest_revision', true)
      } else {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const { data: existingBases } = await supabase
          .from('quotations').select('base_number').like('base_number', `Q-${today}-%`)
        const uniqueBases = new Set((existingBases || []).map(r => r.base_number).filter(Boolean))
        const seqNum = String(uniqueBases.size + 1).padStart(3, '0')
        newBaseNumber = `Q-${today}-${seqNum}`
        newRevisionNumber = 1
        newQuotationNumber = `${newBaseNumber}-1`
      }

      const { id: sourceId, created_at, updated_at, approved_by, approved_at,
              rejection_reason, quotation_number, base_number, revision_number,
              is_latest_revision, source_quotation_id, quotation_items, ...rest } = source

      const newTitle = mode === 'revision'
        ? (() => {
            const m = (rest.title || '').match(/ver(\d+)$/)
            return m
              ? (rest.title.slice(0, -m[0].length) + 'ver' + (Number(m[1]) + 1))
              : (rest.title || '') + 'ver2'
          })()
        : rest.title

      const { data: newQ } = await supabase.from('quotations').insert({
        ...rest, title: newTitle,
        quotation_number: newQuotationNumber, base_number: newBaseNumber,
        revision_number: newRevisionNumber, is_latest_revision: true,
        source_quotation_id: sourceId, status: 'draft', created_by: profile.id,
        issue_date: new Date().toISOString().slice(0, 10),
      }).select('id').single()

      if (source.quotation_items?.length > 0) {
        const newItems = source.quotation_items.map(({ id, quotation_id, created_at, ...item }) => ({
          ...item, quotation_id: newQ.id,
        }))
        await supabase.from('quotation_items').insert(newItems)
      }

      setDuplicateModal(null)
      navigate(`/quotations/${newQ.id}/edit`)
    } finally {
      setDuplicating(false)
    }
  }

  function fmt(n) { return Number(n).toLocaleString('ja-JP') }

  function taxLabel(q) {
    if (q.price_display === 'incl') return { text: '税込', cls: 'bg-blue-50 text-blue-600' }
    return { text: '税抜', cls: 'bg-orange-50 text-orange-600' }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">見積一覧</h1>
        <button
          onClick={() => navigate('/quotations/new')}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> 新規作成
        </button>
      </div>

      {/* 検索バー */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="件名・見積番号・顧客名で検索"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* ステータスフィルター */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {[
          ['all', 'すべて'],
          ['draft', '下書き'],
          ['pending_approval', '承認待ち'],
          ['approved', '承認済み'],
          ['rejected', '差し戻し'],
        ].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
              filter === val
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal size={14} />
          絞り込み
          {activeFilterCount > 0 && (
            <span className="bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600">クリア</button>
        )}
        <button
          onClick={() => setShowOnlyMine(f => !f)}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
            showOnlyMine
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          自分のみ
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none ml-1">
          <input
            type="checkbox"
            checked={showOldRevisions}
            onChange={e => setShowOldRevisions(e.target.checked)}
            className="accent-blue-600 w-3.5 h-3.5"
          />
          旧バージョンを表示
        </label>
      </div>

      {/* 詳細フィルターパネル */}
      {showFilters && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">顧客</label>
            <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
              <option value="">すべて</option>
              {customerOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">発行会社</label>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
              <option value="">すべて</option>
              {companyOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">作成者</label>
            <select value={filterCreator} onChange={e => setFilterCreator(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none">
              <option value="">すべて</option>
              {creatorOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">発行日（開始）</label>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">発行日（終了）</label>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <FileText size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">
            {quotations.length === 0 ? '見積書がありません' : '条件に一致する見積書がありません'}
          </p>
          {quotations.length === 0 && (
            <button onClick={() => navigate('/quotations/new')} className="mt-4 text-sm text-blue-600 hover:underline">
              新規作成する →
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── スマホ: カードリスト ── */}
          <div className="md:hidden space-y-3">
            {filtered.map(q => {
              const st = STATUS_LABELS[q.status] || STATUS_LABELS.draft
              const tl = taxLabel(q)
              const isPending = isApprover && q.status === 'pending_approval'
              return (
                <div
                  key={q.id}
                  className={`rounded-xl border border-gray-200 p-4 shadow-sm ${q.is_latest_revision === false ? 'bg-gray-100' : 'bg-white'}`}
                  onClick={() => navigate(`/quotations/${q.id}/edit`)}
                >
                  {/* 上段: 番号 + ステータス */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-gray-400">{q.quotation_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                      {st.label}
                    </span>
                  </div>

                  {/* 件名 */}
                  <p className="font-semibold text-gray-800 text-sm mb-1 leading-snug break-all">{q.title}</p>

                  {/* 顧客 + 金額 */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-500">{q.customers?.name || q.customer_name || '―'}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${tl.cls}`}>{tl.text}</span>
                      <span className="font-bold text-gray-800 text-sm">
                        ¥{fmt(Number(q.total || 0) - Number(q.tax_amount || 0))}
                      </span>
                    </div>
                  </div>

                  {/* 発行会社 */}
                  {q.companies?.name && (
                    <div className="mb-2">
                      <span className="inline-block text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                        🏢 {q.companies.name}
                      </span>
                    </div>
                  )}

                  {/* 作成者・発行日 */}
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
                    <span>{q.profiles?.name}</span>
                    <span>{q.issue_date}</span>
                  </div>

                  {/* アクションボタン */}
                  {isPending && (
                    <div className="grid grid-cols-2 gap-2 mt-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleApprove(q)}
                        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500 text-white text-sm font-semibold active:bg-green-600"
                      >
                        <CheckCircle size={18} /> 承認する
                      </button>
                      <button
                        onClick={() => setRejectModal(q)}
                        className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-sm font-semibold active:bg-red-600"
                      >
                        <XCircle size={18} /> 差し戻す
                      </button>
                    </div>
                  )}

                  {/* その他操作 */}
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100" onClick={e => e.stopPropagation()}>
                    {(q.status === 'draft' || q.status === 'rejected') && (
                      <button onClick={() => navigate(`/quotations/${q.id}/edit`)}
                        className="flex items-center gap-1 text-xs text-gray-500 py-1">
                        <FileEdit size={14} /> 編集
                      </button>
                    )}
                    {q.status === 'approved' && (
                      <button onClick={() => handlePrint(q)}
                        className="flex items-center gap-1 text-xs text-gray-500 py-1">
                        <Printer size={14} /> PDF
                      </button>
                    )}
                    <button onClick={() => setDuplicateModal(q)}
                      className="flex items-center gap-1 text-xs text-gray-500 py-1">
                      <Copy size={14} /> 複製
                    </button>
                    {canDelete(q) && (
                      <button onClick={() => setDeleteModal(q)}
                        className="flex items-center gap-1 text-xs text-red-400 py-1 ml-auto">
                        <Trash2 size={14} /> 削除
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── PC: テーブル ── */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">見積番号</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">件名</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">発行会社</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">顧客</th>
                  <th className="px-4 py-3 text-right text-xs text-gray-500 font-medium whitespace-nowrap">合計金額（税抜）</th>
                  <th className="px-4 py-3 text-center text-xs text-gray-500 font-medium whitespace-nowrap">表記</th>
                  <th className="px-4 py-3 text-center text-xs text-gray-500 font-medium whitespace-nowrap">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">発行日</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">作成者</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-500 font-medium">承認者</th>
                  <th className="px-4 py-3 text-center text-xs text-gray-500 font-medium whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(q => {
                  const st = STATUS_LABELS[q.status] || STATUS_LABELS.draft
                  const tl = taxLabel(q)
                  return (
                    <tr key={q.id} className={`cursor-pointer ${q.is_latest_revision === false ? 'bg-gray-100 hover:bg-gray-150' : 'hover:bg-gray-50'}`} onClick={() => navigate(`/quotations/${q.id}/edit`)}>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">{q.quotation_number}</td>
                      <td className="px-4 py-3 font-medium text-blue-700 hover:underline">{q.title}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{q.companies?.name || '―'}</td>
                      <td className="px-4 py-3 text-gray-600">{q.customers?.name || q.customer_name || '―'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">¥{fmt(Number(q.total || 0) - Number(q.tax_amount || 0))}</td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${tl.cls}`}>{tl.text}</span>
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{q.issue_date}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{q.profiles?.name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{profileMap[q.approved_by] || profileMap[q.requested_approver_id] || '―'}</td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {(q.status === 'draft' || q.status === 'rejected') && (
                            <button onClick={() => navigate(`/quotations/${q.id}/edit`)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="編集">
                              <FileEdit size={15} />
                            </button>
                          )}
                          {isApprover && q.status === 'pending_approval' && (
                            <>
                              <button onClick={() => handleApprove(q)}
                                className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="承認">
                                <CheckCircle size={15} />
                              </button>
                              <button onClick={() => setRejectModal(q)}
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="差し戻し">
                                <XCircle size={15} />
                              </button>
                            </>
                          )}
                          {q.status === 'approved' && (
                            <button onClick={() => handlePrint(q)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="PDF印刷">
                              <Printer size={15} />
                            </button>
                          )}
                          <button onClick={() => setDuplicateModal(q)}
                            className="p-1.5 text-gray-400 hover:text-purple-600 rounded" title="複製">
                            <Copy size={15} />
                          </button>
                          {canDelete(q) && (
                            <button onClick={() => setDeleteModal(q)}
                              className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="削除">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 差し戻しモーダル */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-800 mb-4">差し戻し理由</h3>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="差し戻しの理由を入力してください"
            />
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => { setRejectModal(null); setRejectReason('') }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
                キャンセル
              </button>
              <button onClick={handleReject}
                className="px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600">
                差し戻す
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteModal && (() => {
        const isApproved = deleteModal.status === 'approved'
        const isPending = deleteModal.status === 'pending_approval'
        const isCritical = isApproved || isPending
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isCritical ? 'bg-red-100' : 'bg-yellow-100'}`}>
                  <span className="text-xl">{isCritical ? '😰' : '⚠️'}</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-gray-900 text-base">
                    {isCritical ? '本当に削除していいですか？😰' : '見積を削除しますか？'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {deleteModal.quotation_number}「{deleteModal.title}」
                    {isApproved && <span className="ml-1 inline-block bg-green-100 text-green-700 px-1.5 py-0.5 rounded">承認済み</span>}
                    {isPending && <span className="ml-1 inline-block bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">承認待ち</span>}
                  </p>
                </div>
              </div>

              <div className={`rounded-lg p-3 mb-5 text-sm ${isCritical ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
                {isCritical ? (
                  <>
                    <p className="font-semibold mb-1">この見積は{isApproved ? '承認済み' : '承認待ち'}です。</p>
                    <p>削除すると<strong>復旧できません</strong>。明細・履歴もすべて失われます。</p>
                  </>
                ) : (
                  <p>この操作は取り消せません。</p>
                )}
              </div>

              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteModal(null)} disabled={deleting}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
                  いいえ
                </button>
                <button onClick={handleDelete} disabled={deleting}
                  className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${isCritical ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'}`}>
                  {deleting ? '削除中...' : (isCritical ? 'はい、削除する' : '削除する')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 複製モーダル */}
      {duplicateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-1">複製方法を選択</h3>
            <p className="text-xs text-gray-500 mb-5">{duplicateModal.quotation_number}「{duplicateModal.title}」</p>
            <div className="space-y-3">
              <button onClick={() => handleDuplicate('revision')} disabled={duplicating}
                className="w-full text-left px-4 py-3 border-2 border-blue-200 bg-blue-50 rounded-xl hover:border-blue-400 hover:bg-blue-100 transition-colors disabled:opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-white bg-blue-500 px-2 py-0.5 rounded-full">修正</span>
                  <span className="text-xs text-blue-600 font-medium">同一見積の改訂版</span>
                </div>
                <div className="text-xs text-blue-700">
                  見積番号を引き継いだ修正版として作成します。<br />
                  例：{duplicateModal.base_number || duplicateModal.quotation_number}-{(duplicateModal.revision_number || 1) + 1}
                </div>
              </button>
              <button onClick={() => handleDuplicate('new')} disabled={duplicating}
                className="w-full text-left px-4 py-3 border-2 border-purple-200 bg-purple-50 rounded-xl hover:border-purple-400 hover:bg-purple-100 transition-colors disabled:opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-white bg-purple-500 px-2 py-0.5 rounded-full">別見積</span>
                  <span className="text-xs text-purple-600 font-medium">新しい見積番号で作成</span>
                </div>
                <div className="text-xs text-purple-700">
                  新しい見積番号で独立した見積として作成します。<br />明細内容はそのままコピーされます。
                </div>
              </button>
            </div>
            <button onClick={() => setDuplicateModal(null)} disabled={duplicating}
              className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700 py-1">
              キャンセル
            </button>
            {duplicating && (
              <div className="flex justify-center mt-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
