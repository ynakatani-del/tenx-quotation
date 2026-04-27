import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function localDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getFiscalPeriod(today, startMonth) {
  const m = today.getMonth() + 1
  const y = today.getFullYear()
  const fiscalYear = m >= startMonth ? y : y - 1
  const from = new Date(fiscalYear, startMonth - 1, 1)
  const toDate = new Date(fiscalYear + 1, startMonth - 1, 0)
  return {
    from: localDateStr(from),
    to: localDateStr(toDate),
  }
}

function fmt(n) { return Number(n).toLocaleString('ja-JP') }

function StatsTable({ data, labelKey, avatarMap }) {
  const total = data.reduce((s, r) => s + r.amount, 0)
  const max = Math.max(...data.map(r => r.amount), 1)
  return (
    <div className="space-y-3">
      {data.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">データがありません</p>
      ) : (
        data.map((row, i) => {
          const label = row[labelKey] || '不明'
          const avatar = avatarMap?.[label]
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <div className="flex items-center gap-2">
                  {avatarMap && (
                    avatar
                      ? <img src={avatar} alt={label} className="w-7 h-7 rounded-full object-cover shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                          <span className="text-xs text-gray-400">{label[0]}</span>
                        </div>
                  )}
                  <span className="font-medium">{label}</span>
                </div>
                <span className="text-gray-400">{row.count}件 ／ ¥{fmt(row.amount)}
                  <span className="ml-2 text-gray-300">({total > 0 ? Math.round(row.amount / total * 100) : 0}%)</span>
                </span>
              </div>
              <div className="bg-gray-100 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-blue-500 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${(row.amount / max) * 100}%`, minWidth: row.amount > 0 ? '1rem' : '0' }}
                />
              </div>
            </div>
          )
        })
      )}
      {data.length > 0 && (
        <div className="flex justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
          <span>合計 {data.reduce((s, r) => s + r.count, 0)}件</span>
          <span>¥{fmt(total)}</span>
        </div>
      )}
    </div>
  )
}

export default function Aggregation() {
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('monthly')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [fiscalStart, setFiscalStart] = useState(12)
  const [approved, setApproved] = useState([])
  const [profileMap, setProfileMap] = useState({})  // name -> avatar_url

  useEffect(() => {
    supabase.from('settings').select('fiscal_month_start').single().then(({ data }) => {
      const sm = data?.fiscal_month_start || 12
      setFiscalStart(sm)
      const { from, to } = getFiscalPeriod(new Date(), sm)
      setDateFrom(from)
      setDateTo(to)
    })
    supabase.from('profiles').select('name, avatar_url').then(({ data }) => {
      const map = {}
      ;(data || []).forEach(p => { if (p.name) map[p.name] = p.avatar_url || null })
      setProfileMap(map)
    })
  }, [])

  useEffect(() => {
    if (dateFrom && dateTo) fetchData()
  }, [dateFrom, dateTo])

  async function fetchData() {
    setLoading(true)
    const { data } = await supabase
      .from('quotations')
      .select('id, total, tax_amount, status, issue_date, customer_id, customer_name, created_by, customers(name), profiles!quotations_created_by_fkey(name, status)')
      .eq('status', 'approved')
      .or('is_latest_revision.is.null,is_latest_revision.is.true')
      .gte('issue_date', dateFrom)
      .lte('issue_date', dateTo)
    setApproved(data || [])
    setLoading(false)
  }

  function setThisFiscal() {
    const { from, to } = getFiscalPeriod(new Date(), fiscalStart)
    setDateFrom(from)
    setDateTo(to)
  }

  // 税抜金額を返すヘルパー
  function taxExcl(q) { return Number(q.total || 0) - Number(q.tax_amount || 0) }

  // 月別集計
  const monthlyData = (() => {
    if (!dateFrom || !dateTo) return []
    const from = new Date(dateFrom)
    const to = new Date(dateTo)
    const months = []
    const cur = new Date(from.getFullYear(), from.getMonth(), 1)
    while (cur <= to) {
      const y = cur.getFullYear()
      const m = cur.getMonth() + 1
      const rows = approved.filter(q => {
        const d = new Date(q.issue_date)
        return d.getFullYear() === y && d.getMonth() + 1 === m
      })
      months.push({
        label: `${y}/${String(m).padStart(2, '0')}`,
        count: rows.length,
        amount: rows.reduce((s, q) => s + taxExcl(q), 0),
      })
      cur.setMonth(cur.getMonth() + 1)
    }
    return months
  })()

  // 担当者別集計（削除ユーザーはunknownに統一）
  const byStaff = (() => {
    const map = {}
    approved.forEach(q => {
      const name = (q.profiles?.status === 'deleted' || !q.profiles?.name)
        ? 'unknown'
        : q.profiles.name
      if (!map[name]) map[name] = { name, count: 0, amount: 0 }
      map[name].count++
      map[name].amount += taxExcl(q)
    })
    return Object.values(map).sort((a, b) => b.amount - a.amount)
  })()

  // 取引先別集計
  const byCustomer = (() => {
    const map = {}
    approved.forEach(q => {
      const name = q.customers?.name || q.customer_name || 'その他'
      if (!map[name]) map[name] = { name, count: 0, amount: 0 }
      map[name].count++
      map[name].amount += taxExcl(q)
    })
    return Object.values(map).sort((a, b) => b.amount - a.amount)
  })()

  const totalAmount = approved.reduce((s, q) => s + taxExcl(q), 0)
  const maxMonthly = Math.max(...monthlyData.map(m => m.amount), 1)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">集計</h1>
      </div>

      {/* 期間選択 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">開始日</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <span className="text-gray-400 pb-2">〜</span>
        <div>
          <label className="block text-xs text-gray-500 mb-1">終了日</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={setThisFiscal}
          className="px-3 py-2 text-sm border border-blue-500 text-blue-600 rounded-lg hover:bg-blue-50">
          今期
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">期間内 承認済み件数</p>
          <p className="text-xl font-bold text-green-700">{approved.length}件</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">期間内 承認済み金額（税抜）</p>
          <p className="text-xl font-bold text-blue-700">¥{fmt(totalAmount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 col-span-2 md:col-span-1">
          <p className="text-xs text-gray-500 mb-1">取引先数</p>
          <p className="text-xl font-bold text-gray-800">{byCustomer.length}社</p>
        </div>
      </div>

      {/* タブ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {[['monthly', '月別'], ['staff', '担当者別'], ['customer', '取引先別']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${tab === key
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : tab === 'monthly' ? (
            <div className="space-y-2">
              {monthlyData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">データがありません</p>
              ) : monthlyData.map(m => (
                <div key={m.label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-14 text-right">{m.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-5 rounded-full transition-all duration-500"
                      style={{ width: `${(m.amount / maxMonthly) * 100}%`, minWidth: m.amount > 0 ? '2rem' : '0' }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 w-36 text-right">
                    {m.amount > 0 ? `¥${fmt(m.amount)}` : '―'}
                    {m.count > 0 && <span className="text-gray-400 ml-1">({m.count}件)</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : tab === 'staff' ? (
            <StatsTable data={byStaff} labelKey="name" avatarMap={profileMap} />
          ) : (
            <StatsTable data={byCustomer} labelKey="name" />
          )}
        </div>
      </div>
    </div>
  )
}
