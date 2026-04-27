import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, ChevronUp, ChevronDown, Copy } from 'lucide-react'
import html2canvas from 'html2canvas'

const GREETING = '毎度御引立て賜り、誠に有難う御座います。\n下記の通り御見積申しあげます。'
const DEFAULT_CATEGORIES = ['材料費', '労務費', '共通費']

const emptyItem = (category = '') => ({
  id: crypto.randomUUID(),
  sort_order: 0,
  name: '',
  spec: '',
  description: '',
  category,
  quantity: 1,
  unit: '式',
  unit_price: 0,
  amount: 0,
  purchase_quantity: 0,
  purchase_unit_price: 0,
})

function calcItem(item) {
  const amount = Number(item.quantity) * Number(item.unit_price)
  const purchase_amount = Number(item.purchase_quantity) * Number(item.purchase_unit_price)
  const profit = amount - purchase_amount
  const profit_rate = amount > 0 ? Math.round((profit / amount) * 100 * 10) / 10 : 0
  return { ...item, amount, purchase_amount, profit, profit_rate }
}

export default function QuotationForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isEdit = !!id

  const [customers, setCustomers] = useState([])
  const [companies, setCompanies] = useState([])
  const [unitPriceTables, setUnitPriceTables] = useState([])
  const [taxRate, setTaxRate] = useState(10)
  const [saving, setSaving] = useState(false)
  const [quotationStatus, setQuotationStatus] = useState(null)
  const [showUnitPriceModal, setShowUnitPriceModal] = useState(null)
  const [upModalStep, setUpModalStep] = useState('tables')
  const [upModalSelectedTable, setUpModalSelectedTable] = useState(null)
  const [upModalTableItems, setUpModalTableItems] = useState([])
  const [upModalSearch, setUpModalSearch] = useState('')
  const [upModalLoading, setUpModalLoading] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [approvers, setApprovers] = useState([])
  const [showApproverModal, setShowApproverModal] = useState(false)
  const [selectedApproverId, setSelectedApproverId] = useState('')

  const [categories, setCategories] = useState([...DEFAULT_CATEGORIES])

  const [form, setForm] = useState({
    title: '',
    customer_id: '',
    customer_name: '',
    company_id: '',
    issue_date: new Date().toISOString().slice(0, 10),
    price_display: 'excl',
    notes: '',
    greeting: GREETING,
    delivery_terms: '別途御打合せ',
    payment_terms: '従来通り',
    validity_period: '発行後90日',
    discount: 0,
    welfare_cost: 0,
  })
  const [items, setItems] = useState([emptyItem(DEFAULT_CATEGORIES[0])])

  useEffect(() => {
    fetchMasterData()
    if (isEdit) loadQuotation()
  }, [id])

  async function fetchMasterData() {
    const [{ data: cust }, { data: comp }, { data: tables }, { data: stg }] = await Promise.all([
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('unit_price_tables').select('*').order('created_at'),
      supabase.from('settings').select('tax_rate').single(),
    ])
    setCustomers(cust || [])
    setCompanies(comp || [])
    setUnitPriceTables(tables || [])
    if (stg) setTaxRate(Number(stg.tax_rate))
    if (!isEdit && comp?.length > 0) {
      setForm(f => ({ ...f, company_id: comp[0].id }))
    }
    // 承認者リスト（admin / super_admin のみ）
    const { data: approverData } = await supabase
      .from('profiles')
      .select('id, name, role, avatar_url')
      .in('role', ['admin', 'super_admin'])
      .order('name')
    setApprovers(approverData || [])
  }

  function openUnitPriceModal(idx) {
    setShowUnitPriceModal(idx)
    setUpModalStep('tables')
    setUpModalSelectedTable(null)
    setUpModalTableItems([])
    setUpModalSearch('')
  }

  async function selectUnitPriceTable(table) {
    setUpModalSelectedTable(table)
    setUpModalStep('items')
    setUpModalSearch('')
    setUpModalLoading(true)
    const { data } = await supabase.from('unit_prices').select('*').eq('table_id', table.id).order('category').order('name')
    setUpModalTableItems(data || [])
    setUpModalLoading(false)
  }

  async function loadQuotation() {
    const { data: q } = await supabase.from('quotations').select('*').eq('id', id).single()
    if (!q) return
    setQuotationStatus(q.status)
    let price_display = q.price_display || 'excl'
    if (!q.price_display && q.tax_type === 'tax_exempt') price_display = 'incl'
    setForm({
      title: q.title,
      customer_id: q.customer_name ? '__direct__' : (q.customer_id || ''),
      customer_name: q.customer_name || '',
      company_id: q.company_id || '',
      issue_date: q.issue_date,
      price_display,
      notes: q.notes || '',
      greeting: q.greeting || GREETING,
      delivery_terms: q.delivery_terms || '別途御打合せ',
      payment_terms: q.payment_terms || '従来通り',
      validity_period: q.validity_period || '発行後90日',
      discount: q.discount || 0,
      welfare_cost: q.welfare_cost || 0,
    })
    setTaxRate(Number(q.tax_rate))
    if (q.categories_json) {
      try { setCategories(JSON.parse(q.categories_json)) } catch { }
    }
    const { data: its } = await supabase.from('quotation_items').select('*').eq('quotation_id', id).order('sort_order')
    if (its?.length) setItems(its.map(i => calcItem({ ...emptyItem(), ...i, id: i.id || crypto.randomUUID() })))
  }

  // カテゴリ操作
  function addCategory() {
    const name = newCategoryName.trim()
    if (!name || categories.includes(name)) return
    setCategories(prev => [...prev, name])
    setNewCategoryName('')
  }

  function removeCategory(idx) {
    const removed = categories[idx]
    setCategories(prev => prev.filter((_, i) => i !== idx))
    // そのカテゴリを参照していたアイテムを空カテゴリに
    setItems(prev => prev.map(item => item.category === removed ? { ...item, category: '' } : item))
  }

  function moveCategory(idx, dir) {
    setCategories(prev => {
      const next = [...prev]
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  // アイテム操作
  function updateItem(idx, field, value) {
    setItems(prev => {
      const next = [...prev]
      const updated = { ...next[idx], [field]: value }
      // 見積数量変更時は仕入数量も連動（仕入数量が見積数量と同じだった場合のみ）
      if (field === 'quantity' && Number(next[idx].purchase_quantity) === Number(next[idx].quantity)) {
        updated.purchase_quantity = value
      }
      next[idx] = calcItem(updated)
      return next
    })
  }

  function addItem(category = '') {
    setItems(prev => [...prev, { ...emptyItem(category), sort_order: prev.length }])
  }

  function duplicateItem(idx) {
    setItems(prev => {
      const copy = { ...prev[idx], id: crypto.randomUUID() }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }

  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function moveItem(idx, dir) {
    setItems(prev => {
      const next = [...prev]
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  function moveItemInGroup(globalIdx, dir) {
    const cat = items[globalIdx].category
    setItems(prev => {
      const catIndices = prev
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.category === cat)
        .map(({ i }) => i)
      const posInGroup = catIndices.indexOf(globalIdx)
      const swapPos = posInGroup + dir
      if (swapPos < 0 || swapPos >= catIndices.length) return prev
      const swapGlobalIdx = catIndices[swapPos]
      const next = [...prev]
      ;[next[globalIdx], next[swapGlobalIdx]] = [next[swapGlobalIdx], next[globalIdx]]
      return next
    })
  }

  function addFromUnitPrice(up, idx) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = calcItem({
        ...next[idx],
        name: up.name,
        spec: up.spec || '',
        unit: up.unit,
        unit_price: Number(up.price),
        purchase_unit_price: Number(up.buy_price || 0),
        purchase_quantity: Number(next[idx].quantity),
      })
      return next
    })
    setShowUnitPriceModal(null)
  }

  const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0)
  const totalPurchase = items.reduce((s, i) => s + Number(i.purchase_amount || 0), 0)
  const discount = Number(form.discount || 0)
  const welfareCost = Number(form.welfare_cost || 0)
  const baseAmount = subtotal - discount + welfareCost
  const tax_amount = form.price_display === 'incl' ? Math.floor(baseAmount * taxRate / 100) : 0
  const total = baseAmount + tax_amount
  // 上部サマリは常に税抜で計算
  const totalProfit = baseAmount - totalPurchase
  const totalProfitRate = baseAmount > 0 ? Math.round((totalProfit / baseAmount) * 100 * 10) / 10 : 0

  function fmt(n) { return Number(n).toLocaleString('ja-JP') }
  function fmtRate(r) { return `${Number(r).toFixed(1)}%` }

  async function captureScreenshot() {
    const el = document.getElementById('quotation-snapshot')
    if (!el) return null
    try {
      const canvas = await html2canvas(el, { scale: 1.5, useCORS: true, backgroundColor: '#f9fafb', logging: false })
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    } catch {
      return null
    }
  }

  async function handleSave(status = 'draft', approverId = null) {
    setSaving(true)
    try {
      const isDirect = form.customer_id === '__direct__'
      const quotationData = {
        title: form.title,
        customer_id: isDirect ? null : (form.customer_id || null),
        customer_name: isDirect ? (form.customer_name || null) : null,
        company_id: form.company_id || null,
        issue_date: form.issue_date,
        price_display: form.price_display,
        tax_type: form.price_display === 'incl' ? 'taxable' : 'tax_exempt',
        notes: form.notes,
        greeting: form.greeting,
        delivery_terms: form.delivery_terms,
        payment_terms: form.payment_terms,
        validity_period: form.validity_period,
        discount: Number(form.discount || 0),
        welfare_cost: Number(form.welfare_cost || 0),
        tax_rate: taxRate,
        subtotal,
        tax_amount,
        total,
        status,
        created_by: profile.id,
        categories_json: JSON.stringify(categories),
        ...(status === 'pending_approval' && approverId ? { requested_approver_id: approverId } : {}),
      }
      let quotationId = id

      if (isEdit) {
        await supabase.from('quotations').update(quotationData).eq('id', id)
        await supabase.from('quotation_items').delete().eq('quotation_id', id)
      } else {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const { data: existingBases } = await supabase
          .from('quotations')
          .select('base_number')
          .like('base_number', `Q-${today}-%`)
        const uniqueBases = new Set((existingBases || []).map(q => q.base_number).filter(Boolean))
        const seqNum = String(uniqueBases.size + 1).padStart(3, '0')
        const baseNumber = `Q-${today}-${seqNum}`
        const quotationNumber = `${baseNumber}-1`
        const { data } = await supabase
          .from('quotations')
          .insert({
            ...quotationData,
            quotation_number: quotationNumber,
            base_number: baseNumber,
            revision_number: 1,
            is_latest_revision: true,
          })
          .select('id')
          .single()
        quotationId = data.id
      }

      const itemsToInsert = items
        .filter(i => i.name.trim())
        .map((item, idx) => ({
          quotation_id: quotationId,
          sort_order: idx,
          name: item.name,
          spec: item.spec || null,
          description: item.description || null,
          category: item.category || '',
          quantity: Number(item.quantity),
          unit: item.unit,
          unit_price: Number(item.unit_price),
          amount: Number(item.amount),
          purchase_quantity: Number(item.purchase_quantity || 0),
          purchase_unit_price: Number(item.purchase_unit_price || 0),
        }))

      if (itemsToInsert.length > 0) {
        await supabase.from('quotation_items').insert(itemsToInsert)
      }

      if (status === 'pending_approval') {
        const screenshot = await captureScreenshot()
        try {
          await supabase.functions.invoke('send-approval-email', {
            body: { quotation_id: quotationId, screenshot_base64: screenshot },
          })
        } catch (emailErr) {
          console.error('承認メール送信失敗:', emailErr)
        }
      }

      navigate('/quotations')
    } finally {
      setSaving(false)
    }
  }

  const isReadOnly = isEdit && (quotationStatus === 'approved' || quotationStatus === 'pending_approval')

  const STATUS_LABEL = {
    approved: { text: '承認済み', cls: 'bg-green-100 text-green-700' },
    pending_approval: { text: '承認待ち', cls: 'bg-yellow-100 text-yellow-700' },
    rejected: { text: '差し戻し', cls: 'bg-red-100 text-red-700' },
    draft: { text: '下書き', cls: 'bg-gray-100 text-gray-600' },
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-800">
            {!isEdit ? '見積書作成' : isReadOnly ? '見積書閲覧' : '見積書編集'}
          </h1>
          {quotationStatus && STATUS_LABEL[quotationStatus] && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_LABEL[quotationStatus].cls}`}>
              {STATUS_LABEL[quotationStatus].text}
            </span>
          )}
        </div>
        <button onClick={() => navigate('/quotations')} className="text-sm text-gray-500 hover:text-gray-700">← 一覧に戻る</button>
      </div>

      {/* サマリーバー */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">見積金額（税抜）</p>
            <p className="text-lg font-bold text-blue-700">¥{fmt(baseAmount)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">仕入金額</p>
            <p className="text-lg font-bold text-gray-700">¥{fmt(totalPurchase)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">利益</p>
            <p className={`text-lg font-bold ${totalProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>¥{fmt(totalProfit)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 mb-0.5">利益率</p>
            <p className={`text-lg font-bold ${totalProfitRate >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtRate(totalProfitRate)}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {!isReadOnly && <span className="text-sm text-gray-500">表示形式：</span>}
            {!isReadOnly ? (
              [['excl', '税抜（消費税なし）'], ['incl', `税込（消費税${taxRate}%を加算）`]].map(([val, label]) => (
                <label key={val} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" value={val} checked={form.price_display === val}
                    onChange={e => setForm(f => ({ ...f, price_display: e.target.value }))}
                    className="accent-blue-600" />
                  {label}
                </label>
              ))
            ) : (
              <span className="text-sm text-gray-500">
                {form.price_display === 'incl' ? `税込（消費税${taxRate}%を加算）` : '税抜（消費税なし）'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div id="quotation-snapshot" className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">

        {/* 基本情報 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">件名 *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              readOnly={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`}
              placeholder="例：〇〇システム開発費用" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">顧客</label>
            <select value={form.customer_id}
              onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, customer_name: '' }))}
              disabled={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'opacity-100 bg-gray-50 cursor-default text-gray-900' : ''}`}>
              <option value="">選択してください</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__direct__">── 直接入力 ──</option>
            </select>
            {form.customer_id === '__direct__' && (
              <input
                value={form.customer_name}
                onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                readOnly={isReadOnly}
                placeholder="顧客名を入力"
                className={`mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">発行会社</label>
            <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
              disabled={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'opacity-100 bg-gray-50 cursor-default text-gray-900' : ''}`}>
              <option value="">選択してください</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">発行日 *</label>
            <input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))}
              readOnly={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">納期</label>
            <input value={form.delivery_terms} onChange={e => setForm(f => ({ ...f, delivery_terms: e.target.value }))}
              readOnly={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">支払条件</label>
            <input value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))}
              readOnly={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">見積有効期間</label>
            <input value={form.validity_period} onChange={e => setForm(f => ({ ...f, validity_period: e.target.value }))}
              readOnly={isReadOnly}
              className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50' : ''}`} />
          </div>
        </div>

        {/* 大項目（カテゴリ）管理 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">大項目（カテゴリ）</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((cat, idx) => (
              <div key={idx} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
                {!isReadOnly && (
                  <>
                    <button onClick={() => moveCategory(idx, -1)} className="text-blue-400 hover:text-blue-700 disabled:opacity-30"
                      disabled={idx === 0}><ChevronUp size={13} /></button>
                    <button onClick={() => moveCategory(idx, 1)} className="text-blue-400 hover:text-blue-700 disabled:opacity-30"
                      disabled={idx === categories.length - 1}><ChevronDown size={13} /></button>
                  </>
                )}
                <span className="text-sm font-medium text-blue-800 px-1">■{cat}</span>
                {!isReadOnly && (
                  <button onClick={() => removeCategory(idx)} className="text-red-300 hover:text-red-500 ml-1">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!isReadOnly && (
            <div className="flex gap-2 items-center">
              <input
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="新しい大項目名"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
              <button onClick={addCategory}
                className="flex items-center gap-1 text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50">
                <Plus size={14} /> 追加
              </button>
            </div>
          )}
        </div>

        {/* 明細 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">明細</h2>

          <div className="overflow-x-auto">
            <div className="relative" style={{ minWidth: '1050px' }}>
              {isReadOnly && <div className="absolute inset-0 z-10" />}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-blue-700 text-white">
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left text-xs">品名</th>
                  <th className="px-3 py-2 text-left text-xs w-28">仕様</th>
                  <th className="px-2 py-2 text-center text-xs w-16">見積数量</th>
                  <th className="px-2 py-2 text-center text-xs w-12">単位</th>
                  <th className="px-3 py-2 text-right text-xs w-24">見積単価</th>
                  <th className="px-3 py-2 text-right text-xs w-24">見積金額</th>
                  <th className="px-2 py-2 text-center text-xs w-16 border-l-2 border-blue-500">仕入数量</th>
                  <th className="px-3 py-2 text-right text-xs w-24">仕入単価</th>
                  <th className="px-3 py-2 text-right text-xs w-24">仕入金額</th>
                  <th className="px-3 py-2 text-right text-xs w-20">利益率</th>
                  <th className="px-2 py-2 text-center text-xs w-16">{!isReadOnly && '操作'}</th>
                </tr>
              </thead>
              {[...categories, ...(items.some(i => !i.category || !categories.includes(i.category)) ? ['__others__'] : [])].map(cat => {
                const isOther = cat === '__others__'
                const catLabel = isOther ? '未分類' : cat
                const catItems = items
                  .map((item, globalIdx) => ({ item, globalIdx }))
                  .filter(({ item }) => isOther
                    ? (!item.category || !categories.includes(item.category))
                    : item.category === cat)
                const catSubtotal = catItems.reduce((s, { item }) => s + Number(item.amount || 0), 0)
                return (
                  <tbody key={cat}>
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td colSpan={6} className="px-4 py-2">
                        <span className="text-sm font-semibold text-blue-800">■ {catLabel}</span>
                      </td>
                      <td colSpan={6} className="px-4 py-2 text-right">
                        <span className="text-sm font-semibold text-blue-700">小計 ¥{fmt(catSubtotal)}</span>
                      </td>
                    </tr>
                    {catItems.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-3 text-center text-gray-400 text-xs">行がありません</td>
                      </tr>
                    ) : catItems.map(({ item, globalIdx }, posInGroup) => {
                      const purchase_amount = Number(item.purchase_quantity || 0) * Number(item.purchase_unit_price || 0)
                      const profit_rate = item.amount > 0
                        ? Math.round(((item.amount - purchase_amount) / item.amount) * 100 * 10) / 10
                        : 0
                      return (
                        <tr key={item.id} className={posInGroup % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}>
                          <td className="border border-gray-200 px-1 py-1">
                            {!isReadOnly && (
                              <div className="flex flex-col items-center gap-0.5">
                                <button onClick={() => moveItemInGroup(globalIdx, -1)} className="text-gray-400 hover:text-gray-600"><ChevronUp size={13} /></button>
                                <button onClick={() => moveItemInGroup(globalIdx, 1)} className="text-gray-400 hover:text-gray-600"><ChevronDown size={13} /></button>
                              </div>
                            )}
                          </td>
                          <td className="border border-gray-200 px-2 py-1">
                            <div className="flex gap-1 items-center">
                              <input value={item.name} onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                className="flex-1 min-w-0 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm"
                                placeholder="品名" />
                              {!isReadOnly && unitPriceTables.length > 0 && (
                                <button onClick={() => openUnitPriceModal(globalIdx)}
                                  className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap px-1">単価表</button>
                              )}
                            </div>
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input value={item.spec || ''} onChange={e => updateItem(globalIdx, 'spec', e.target.value)}
                              className="w-full border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-xs text-gray-500"
                              placeholder="型番・仕様" />
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input type="number" value={item.quantity} onChange={e => updateItem(globalIdx, 'quantity', e.target.value)}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input value={item.unit} onChange={e => updateItem(globalIdx, 'unit', e.target.value)}
                              className="w-full text-center border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" />
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input type="number" value={item.unit_price} onChange={e => updateItem(globalIdx, 'unit_price', e.target.value)}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                          </td>
                          <td className="border border-gray-200 px-2 py-1 text-right text-sm font-medium text-gray-700">
                            ¥{fmt(item.amount)}
                          </td>
                          <td className="border border-gray-200 border-l-2 border-l-blue-200 px-1 py-1">
                            <input type="number" value={item.purchase_quantity || 0} onChange={e => updateItem(globalIdx, 'purchase_quantity', e.target.value)}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input type="number" value={item.purchase_unit_price || 0} onChange={e => updateItem(globalIdx, 'purchase_unit_price', e.target.value)}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                          </td>
                          <td className="border border-gray-200 px-2 py-1 text-right text-sm text-gray-600">
                            ¥{fmt(purchase_amount)}
                          </td>
                          <td className={`border border-gray-200 px-2 py-1 text-right text-sm font-medium ${profit_rate >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                            {fmtRate(profit_rate)}
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            {!isReadOnly && (
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => duplicateItem(globalIdx)} title="複製"
                                  className="text-blue-400 hover:text-blue-600"><Copy size={13} /></button>
                                <button onClick={() => removeItem(globalIdx)} title="削除"
                                  className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {!isOther && !isReadOnly && (
                      <tr>
                        <td colSpan={12} className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
                          <button onClick={() => addItem(cat)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                            <Plus size={12} /> {cat}に行を追加
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                )
              })}
            </table>
            </div>
          </div>

          {/* 合計エリア */}
          <div className="mt-4 flex justify-end">
            <div className="w-80 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">小計</span>
                <span>¥{fmt(subtotal)}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">御値引き</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">¥</span>
                  <input type="number" value={form.discount} min="0"
                    onChange={e => setForm(f => ({ ...f, discount: e.target.value }))}
                    readOnly={isReadOnly}
                    className={`w-28 text-right border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${isReadOnly ? 'cursor-default' : ''}`} />
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">法定福利費</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">¥</span>
                  <input type="number" value={form.welfare_cost} min="0"
                    onChange={e => setForm(f => ({ ...f, welfare_cost: e.target.value }))}
                    readOnly={isReadOnly}
                    className={`w-28 text-right border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${isReadOnly ? 'cursor-default' : ''}`} />
                </div>
              </div>

              {form.price_display === 'incl' && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">消費税（{taxRate}%）</span>
                  <span>¥{fmt(tax_amount)}</span>
                </div>
              )}

              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                <span>{form.price_display === 'incl' ? '合計（税込）' : '合計（税別）'}</span>
                <span className="text-blue-700">¥{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 備考 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
            readOnly={isReadOnly}
            className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default resize-none' : ''}`} />
        </div>

        {/* ボタン */}
        <div className="flex gap-3 justify-end">
          <button onClick={() => navigate('/quotations')}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            {isReadOnly ? '一覧に戻る' : 'キャンセル'}
          </button>
          {!isReadOnly && (
            <>
              <button onClick={() => handleSave('draft')} disabled={saving || !form.title}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">下書き保存</button>
              <button
                onClick={() => { setSelectedApproverId(''); setShowApproverModal(true) }}
                disabled={saving || !form.title}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? '保存中...' : '承認申請'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 承認申請先選択モーダル */}
      {showApproverModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
            <h3 className="font-semibold text-gray-800 mb-1">承認申請先を選択</h3>
            <p className="text-xs text-gray-500 mb-4">承認をお願いする担当者を選んでください</p>
            <div className="space-y-2 mb-5">
              {approvers.map(a => (
                <label key={a.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedApproverId === a.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <input type="radio" name="approver" value={a.id}
                    checked={selectedApproverId === a.id}
                    onChange={() => setSelectedApproverId(a.id)}
                    className="accent-blue-600" />
                  {a.avatar_url
                    ? <img src={a.avatar_url} className="w-8 h-8 rounded-full object-cover" alt={a.name} />
                    : <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">{(a.name || '?')[0]}</div>
                  }
                  <div>
                    <p className="text-sm font-medium text-gray-800">{a.name}</p>
                    <p className="text-xs text-gray-400">{a.role === 'super_admin' ? '特権管理者' : '管理者'}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowApproverModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
                キャンセル
              </button>
              <button
                onClick={() => {
                  setShowApproverModal(false)
                  handleSave('pending_approval', selectedApproverId || null)
                }}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                申請する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 単価表モーダル */}
      {showUnitPriceModal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                {upModalStep === 'items' && (
                  <button onClick={() => setUpModalStep('tables')} className="text-gray-400 hover:text-gray-700 text-sm mr-1">← 戻る</button>
                )}
                <h3 className="font-semibold text-gray-800">
                  {upModalStep === 'tables' ? '単価表を選択' : upModalSelectedTable?.name}
                </h3>
              </div>
              <button onClick={() => setShowUnitPriceModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {upModalStep === 'tables' && (
              <div className="overflow-y-auto flex-1 p-2">
                {unitPriceTables.length === 0 ? (
                  <p className="text-center text-gray-400 py-10 text-sm">単価表がありません</p>
                ) : (
                  unitPriceTables.map(table => (
                    <button key={table.id} onClick={() => selectUnitPriceTable(table)}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 rounded-lg flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{table.name}</span>
                      <span className="text-gray-400 text-sm">›</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {upModalStep === 'items' && (
              <>
                <div className="px-4 py-2 border-b">
                  <input
                    value={upModalSearch}
                    onChange={e => setUpModalSearch(e.target.value)}
                    placeholder="品名・仕様で検索"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div className="overflow-y-auto flex-1 p-2">
                  {upModalLoading ? (
                    <p className="text-center text-gray-400 py-10 text-sm">読み込み中...</p>
                  ) : (() => {
                    const filtered = upModalTableItems.filter(up =>
                      !upModalSearch ||
                      up.name.toLowerCase().includes(upModalSearch.toLowerCase()) ||
                      (up.spec || '').toLowerCase().includes(upModalSearch.toLowerCase())
                    )
                    if (filtered.length === 0) return <p className="text-center text-gray-400 py-10 text-sm">該当なし</p>
                    return filtered.map(up => (
                      <button key={up.id} onClick={() => addFromUnitPrice(up, showUnitPriceModal)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 rounded-lg flex justify-between items-center">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{up.name}</p>
                          {up.spec && <p className="text-xs text-gray-500">{up.spec}</p>}
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <p className="text-sm font-semibold text-blue-700">¥{fmt(up.price)}</p>
                          <p className="text-xs text-gray-400">{up.unit}</p>
                        </div>
                      </button>
                    ))
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
