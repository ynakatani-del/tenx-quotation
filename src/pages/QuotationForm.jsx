import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, ChevronUp, ChevronDown, Copy, List, Printer } from 'lucide-react'

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
  is_misc_expense: false,
})

const miscExpenseItem = () => ({
  ...emptyItem('材料費'),
  name: '雑材消耗品',
  is_misc_expense: true,
  misc_expense_rate: 10,
  misc_expense_manual: false,
})

const MANAGED_DEFAULTS = [
  { name: '現場管理費', rate: 15, base_cats: ['材料費', '労務費'] },
  { name: '一般管理費', rate: 10, base_cats: ['材料費', '労務費'] },
  { name: '安全対策費', rate: 3,  base_cats: ['労務費'] },
  { name: '諸経費',     rate: 3,  base_cats: ['材料費', '労務費', '共通費'] },
]

const managedExpenseItem = (name, rate, base_cats = ['材料費', '労務費']) => ({
  ...emptyItem('共通費'),
  name,
  is_managed_expense: true,
  managed_expense_rate: rate,
  managed_expense_manual: false,
  base_cats,
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
  const [showUnitPriceModal, setShowUnitPriceModal] = useState(null) // カテゴリ名 or null
  const [upModalStep, setUpModalStep] = useState('tables') // 'tables' | 'items'
  const [upModalSelectedTableIds, setUpModalSelectedTableIds] = useState(new Set())
  const [upModalAllItems, setUpModalAllItems] = useState([])
  const [upModalCheckedIds, setUpModalCheckedIds] = useState(new Set())
  const [upModalSearch, setUpModalSearch] = useState('')
  const [upModalLoading, setUpModalLoading] = useState(false)
  const [tableCategoryMap, setTableCategoryMap] = useState({})
  const [newCategoryName, setNewCategoryName] = useState('')
  const [approvers, setApprovers] = useState([])
  const [showApproverModal, setShowApproverModal] = useState(false)
  const [selectedApproverId, setSelectedApproverId] = useState('')
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [quotationMeta, setQuotationMeta] = useState({ number: '', baseNumber: '', revisionNumber: 1 })

  const [categories, setCategories] = useState([...DEFAULT_CATEGORIES])
  const [categoryMeta, setCategoryMeta] = useState({}) // { catName: 'material' | 'labor' | 'overhead' }
  const [newCategoryType, setNewCategoryType] = useState('overhead')

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
    discount_rate: 0,
    discount_manual: false,
    welfare_cost: 0,
    welfare_rate: 16,
    welfare_manual: false,
  })
  const [items, setItems] = useState([
    emptyItem(DEFAULT_CATEGORIES[0]),
    miscExpenseItem(),
    ...MANAGED_DEFAULTS.map(({ name, rate, base_cats }) => managedExpenseItem(name, rate, base_cats)),
  ])

  useEffect(() => {
    fetchMasterData()
    if (isEdit) loadQuotation()
  }, [id])

  async function fetchMasterData() {
    const [{ data: cust }, { data: comp }, { data: tables }, { data: stg }] = await Promise.all([
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('unit_price_tables').select('*').order('created_at'),
      supabase.from('settings').select('tax_rate, expense_defaults').single(),
    ])
    setCustomers(cust || [])
    setCompanies(comp || [])
    setUnitPriceTables(tables || [])
    // テーブルごとのカテゴリマップ構築（単価表フィルタリング用）
    const { data: upCats } = await supabase.from('unit_prices').select('table_id, category')
    const catMap = {}
    ;(upCats || []).forEach(({ table_id, category }) => {
      if (!catMap[table_id]) catMap[table_id] = new Set()
      catMap[table_id].add(category)
    })
    setTableCategoryMap(catMap)
    if (stg) setTaxRate(Number(stg.tax_rate))
    // 新規作成時は設定のデフォルト率を適用
    if (!isEdit && stg?.expense_defaults) {
      try {
        const def = JSON.parse(stg.expense_defaults)
        setItems(prev => prev.map(item => {
          if (item.is_misc_expense) return { ...item, misc_expense_rate: Number(def.zaizai_rate ?? 10) }
          if (item.is_managed_expense && def.managed?.[item.name]) {
            const md = def.managed[item.name]
            return { ...item, managed_expense_rate: Number(md.rate ?? item.managed_expense_rate), base_cats: md.base_cats ?? item.base_cats }
          }
          return item
        }))
        setForm(f => ({
          ...f,
          welfare_rate: Number(def.welfare_rate ?? 16),
          discount_rate: Number(def.discount_rate ?? 0),
        }))
      } catch {}
    }
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

  function openUnitPriceModal(cat) {
    setShowUnitPriceModal(cat)
    setUpModalStep('tables')
    setUpModalSelectedTableIds(new Set())
    setUpModalAllItems([])
    setUpModalCheckedIds(new Set())
    setUpModalSearch('')
  }

  async function loadUnitPriceItems() {
    setUpModalStep('items')
    setUpModalSearch('')
    setUpModalLoading(true)
    setUpModalCheckedIds(new Set())
    const ids = [...upModalSelectedTableIds]
    const { data } = await supabase
      .from('unit_prices').select('*')
      .in('table_id', ids)
      .order('category').order('name')
    // 現在のカテゴリに一致する品目のみ
    const cat = showUnitPriceModal
    const filtered = (data || []).filter(i => !cat || i.category === cat)
    setUpModalAllItems(filtered)
    setUpModalLoading(false)
  }

  function toggleTableId(id) {
    setUpModalSelectedTableIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleItemId(id) {
    setUpModalCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function loadQuotation() {
    const { data: q } = await supabase.from('quotations').select('*').eq('id', id).single()
    if (!q) return
    setQuotationStatus(q.status)
    setQuotationMeta({ number: q.quotation_number || '', baseNumber: q.base_number || q.quotation_number || '', revisionNumber: q.revision_number || 1 })
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
      discount_rate: q.discount_rate ?? 0,
      discount_manual: q.discount_manual ?? false,
      welfare_cost: q.welfare_cost || 0,
      welfare_rate: q.welfare_rate ?? 16,
      welfare_manual: q.welfare_manual ?? false,
    })
    setTaxRate(Number(q.tax_rate))
    if (q.categories_json) {
      try {
        const parsed = JSON.parse(q.categories_json)
        if (Array.isArray(parsed)) {
          setCategories(parsed)
        } else {
          setCategories(parsed.list || [])
          if (parsed.meta) setCategoryMeta(parsed.meta)
        }
      } catch {}
    }
    const [{ data: its }, { data: stgDef }] = await Promise.all([
      supabase.from('quotation_items').select('*').eq('quotation_id', id).order('sort_order'),
      supabase.from('settings').select('expense_defaults').single(),
    ])
    if (its?.length) {
      let expDef = {}
      try { expDef = JSON.parse(stgDef?.expense_defaults || '{}') } catch {}

      const mappedItems = its.map(i => {
        const is_managed_expense = i.spec?.startsWith('__managed__:')
        let managed_expense_rate = 0, base_cats = ['材料費', '労務費']
        if (is_managed_expense) {
          const parts = i.spec.split(':')
          managed_expense_rate = Number(parts[1]) || 0
          base_cats = parts[2] ? parts[2].split(',') : ['材料費', '労務費']
        }
        const is_misc_expense = !is_managed_expense && i.name === '雑材消耗品' && i.category === '材料費'
        const misc_expense_rate = is_misc_expense && !isNaN(Number(i.spec)) ? Number(i.spec) : 10
        const specVal = (is_misc_expense || is_managed_expense) ? '' : (i.spec || '')
        const base = {
          ...emptyItem(), ...i, id: i.id || crypto.randomUUID(),
          is_misc_expense, misc_expense_rate, misc_expense_manual: false,
          is_managed_expense, managed_expense_rate, managed_expense_manual: false,
          base_cats, spec: specVal,
        }
        return (is_misc_expense || is_managed_expense) ? base : calcItem(base)
      })

      // 複製や旧データ: 欠けている特殊行を補完
      const loadedCats = (() => {
        try { const p = JSON.parse(q.categories_json || '[]'); return Array.isArray(p) ? p : (p.list || []) }
        catch { return [...DEFAULT_CATEGORIES] }
      })()

      if (loadedCats.includes('材料費') && !mappedItems.some(i => i.is_misc_expense)) {
        const rate = Number(expDef.zaizai_rate ?? 10)
        const newMisc = { ...miscExpenseItem(), misc_expense_rate: rate }
        const lastMatIdx = mappedItems.reduce((last, item, idx) => item.category === '材料費' ? idx : last, -1)
        mappedItems.splice(lastMatIdx + 1, 0, newMisc)
      }

      if (loadedCats.includes('共通費')) {
        for (const { name, rate: defRate, base_cats: defBaseCats } of MANAGED_DEFAULTS) {
          if (!mappedItems.some(i => i.is_managed_expense && i.name === name)) {
            const md = expDef.managed?.[name]
            mappedItems.push(managedExpenseItem(name, Number(md?.rate ?? defRate), md?.base_cats ?? defBaseCats))
          }
        }
      }

      setItems(mappedItems)
    }
  }

  // カテゴリ操作
  function getCatType(cat) {
    if (cat === '材料費') return 'material'
    if (cat === '労務費') return 'labor'
    if (cat === '共通費') return 'overhead'
    return categoryMeta[cat] || 'overhead'
  }

  function addCategory() {
    const name = newCategoryName.trim()
    if (!name || categories.includes(name)) return
    setCategories(prev => [...prev, name])
    setCategoryMeta(prev => ({ ...prev, [name]: newCategoryType }))
    setNewCategoryName('')
    setNewCategoryType('overhead')
  }

  function removeCategory(idx) {
    const removed = categories[idx]
    setCategories(prev => prev.filter((_, i) => i !== idx))
    setCategoryMeta(prev => { const n = { ...prev }; delete n[removed]; return n })
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
      if (updated.is_misc_expense) {
        next[idx] = updated
        return next
      }
      if (field === 'quantity' && Number(next[idx].purchase_quantity) === Number(next[idx].quantity)) {
        updated.purchase_quantity = value
      }
      next[idx] = calcItem(updated)
      return next
    })
  }

  function addItem(category = '') {
    setItems(prev => {
      const newItem = { ...emptyItem(category), sort_order: prev.length }
      const fixedIdx = prev.findIndex(i => (i.is_misc_expense || i.is_managed_expense) && i.category === category)
      if (fixedIdx !== -1) {
        const next = [...prev]
        next.splice(fixedIdx, 0, newItem)
        return next.map((item, i) => ({ ...item, sort_order: i }))
      }
      return [...prev, newItem]
    })
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
        .filter(({ item }) => item.category === cat && !item.is_misc_expense && !item.is_managed_expense)
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

  function addFromUnitPriceMulti() {
    const cat = showUnitPriceModal
    const selected = upModalAllItems.filter(i => upModalCheckedIds.has(i.id))
    if (selected.length === 0) return
    setItems(prev => {
      const newRows = selected.map(up => calcItem({
        ...emptyItem(cat),
        name: up.name,
        spec: up.spec || '',
        unit: up.unit,
        unit_price: Number(up.price),
        purchase_quantity: 1,
        purchase_unit_price: Number(up.buy_price || 0),
      }))
      // 固定行（misc/managed）の直前、なければカテゴリ最終行の直後に挿入
      const firstFixedIdx = prev.findIndex(i => (i.is_misc_expense || i.is_managed_expense) && i.category === cat)
      const catIndices = prev
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.category === cat && !item.is_misc_expense && !item.is_managed_expense)
        .map(({ i }) => i)
      const insertAt = firstFixedIdx !== -1 ? firstFixedIdx : (catIndices.length > 0 ? catIndices[catIndices.length - 1] + 1 : prev.length)
      const next = [...prev]
      next.splice(insertAt, 0, ...newRows)
      return next.map((item, i) => ({ ...item, sort_order: i }))
    })
    setShowUnitPriceModal(null)
  }

  // 雑材消耗品: 材料費（雑材除く）の小計×レート
  const miscItem = items.find(i => i.is_misc_expense)
  const zaizaiRate = Number(miscItem?.misc_expense_rate ?? 10)
  const zaizaiBase = items
    .filter(i => i.category === '材料費' && !i.is_misc_expense)
    .reduce((s, i) => s + Number(i.amount || 0), 0)
  const zaizaiAutoAmount = Math.round(zaizaiBase * zaizaiRate / 100)
  const zaizaiAmount = miscItem?.misc_expense_manual ? Number(miscItem.amount || 0) : zaizaiAutoAmount

  // 管理費計算のカテゴリ別基礎額（カスタムカテゴリも含む）
  function getCatNonManagedSum(cat) {
    return items.filter(i => i.category === cat && !i.is_managed_expense).reduce((s, i) => {
      if (i.is_misc_expense) return s + zaizaiAmount
      return s + Number(i.amount || 0)
    }, 0)
  }
  const materialBase = categories.filter(c => getCatType(c) === 'material').reduce((s, c) => s + getCatNonManagedSum(c), 0)
  const laborBase = categories.filter(c => getCatType(c) === 'labor').reduce((s, c) => s + getCatNonManagedSum(c), 0)
  const commonNonManagedBase = categories.filter(c => getCatType(c) === 'overhead').reduce((s, c) => s + getCatNonManagedSum(c), 0)

  function getManagedAmount(item) {
    if (item.managed_expense_manual) return Number(item.amount || 0)
    const cats = item.base_cats || ['材料費', '労務費']
    let base = 0
    if (cats.includes('材料費')) base += materialBase
    if (cats.includes('労務費')) base += laborBase
    if (cats.includes('共通費')) base += commonNonManagedBase
    return Math.round(base * Number(item.managed_expense_rate ?? 0) / 100)
  }

  const subtotal = items.reduce((s, i) => {
    if (i.is_misc_expense) return s + zaizaiAmount
    if (i.is_managed_expense) return s + getManagedAmount(i)
    return s + Number(i.amount || 0)
  }, 0)
  const totalPurchase = items.reduce((s, i) => s + Number(i.purchase_amount || 0), 0)

  const autoDiscount = Math.round(subtotal * Number(form.discount_rate || 0) / 100)
  const discount = form.discount_manual ? Number(form.discount || 0) : autoDiscount

  const autoWelfareCost = Math.round(laborBase * Number(form.welfare_rate || 0) / 100)
  const welfareCost = form.welfare_manual ? Number(form.welfare_cost || 0) : autoWelfareCost

  const baseAmount = subtotal - discount + welfareCost
  const tax_amount = form.price_display === 'incl' ? Math.floor(baseAmount * taxRate / 100) : 0
  const total = baseAmount + tax_amount
  // 上部サマリは常に税抜で計算
  const totalProfit = baseAmount - totalPurchase
  const totalProfitRate = baseAmount > 0 ? Math.round((totalProfit / baseAmount) * 100 * 10) / 10 : 0

  function fmt(n) { return Number(n).toLocaleString('ja-JP') }
  function fmtRate(r) { return `${Number(r).toFixed(1)}%` }

  function captureScreenshot(quotationId) {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;top:0;left:-1400px;width:1200px;height:2000px;opacity:0;pointer-events:none;z-index:-1;'
      document.body.appendChild(iframe)

      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler)
        if (iframe.parentNode) document.body.removeChild(iframe)
        resolve(null)
      }, 25000)

      function handler(e) {
        if (e.data?.type === 'quotation-screenshot') {
          window.removeEventListener('message', handler)
          clearTimeout(timeout)
          if (iframe.parentNode) document.body.removeChild(iframe)
          resolve(e.data.data)
        }
      }
      window.addEventListener('message', handler)
      iframe.src = `/quotations/${quotationId}/print?email=1`
    })
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
        discount,
        discount_rate: Number(form.discount_rate || 0),
        discount_manual: form.discount_manual,
        welfare_cost: welfareCost,
        welfare_rate: Number(form.welfare_rate || 0),
        welfare_manual: form.welfare_manual,
        tax_rate: taxRate,
        subtotal,
        tax_amount,
        total,
        status,
        created_by: profile.id,
        categories_json: JSON.stringify({ list: categories, meta: categoryMeta }),
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
        .filter(i => i.is_misc_expense || i.is_managed_expense || i.name.trim())
        .map((item, idx) => ({
          quotation_id: quotationId,
          sort_order: idx,
          name: item.name,
          spec: item.is_managed_expense
            ? `__managed__:${item.managed_expense_rate ?? 0}:${(item.base_cats || ['材料費', '労務費']).join(',')}`
            : item.is_misc_expense
              ? String(item.misc_expense_rate ?? 10)
              : (item.spec || null),
          description: item.description || null,
          category: item.category || '',
          quantity: Number(item.quantity),
          unit: item.unit,
          unit_price: item.is_misc_expense ? zaizaiAmount : item.is_managed_expense ? getManagedAmount(item) : Number(item.unit_price),
          amount: item.is_misc_expense ? zaizaiAmount : item.is_managed_expense ? getManagedAmount(item) : Number(item.amount),
          purchase_quantity: Number(item.purchase_quantity || 0),
          purchase_unit_price: Number(item.purchase_unit_price || 0),
        }))

      if (itemsToInsert.length > 0) {
        await supabase.from('quotation_items').insert(itemsToInsert)
      }

      if (status === 'pending_approval') {
        const screenshot = await captureScreenshot(quotationId)
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

  async function handleDuplicate(mode) {
    setDuplicating(true)
    try {
      const { data: source } = await supabase
        .from('quotations').select('*, quotation_items(*)').eq('id', id).single()

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

      const { data: newQ } = await supabase.from('quotations').insert({
        ...rest, quotation_number: newQuotationNumber, base_number: newBaseNumber,
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

      setShowDuplicateModal(false)
      navigate(`/quotations/${newQ.id}/edit`)
    } finally {
      setDuplicating(false)
    }
  }

  const isReadOnly = isEdit && (quotationStatus === 'approved' || quotationStatus === 'pending_approval')
  const customerOk = form.customer_id && (form.customer_id !== '__direct__' || form.customer_name.trim())
  const isFormValid = !!form.title && !!customerOk && !!form.company_id

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
        <div className="flex items-center gap-2">
          {isReadOnly && (
            <>
              <button onClick={() => setShowDuplicateModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                <Copy size={14} /> 複製
              </button>
              <button onClick={() => navigate(`/quotations/${id}/print`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                <Printer size={14} /> 印刷
              </button>
            </>
          )}
          <button onClick={() => navigate('/quotations')} className="text-sm text-gray-500 hover:text-gray-700">← 一覧に戻る</button>
        </div>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">顧客 *</label>
            <select value={form.customer_id}
              onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, customer_name: '' }))}
              disabled={isReadOnly}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'opacity-100 bg-gray-50 cursor-default text-gray-900 border-gray-300' : (!form.customer_id ? 'border-red-300 bg-red-50' : 'border-gray-300')}`}>
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
                className={`mt-1.5 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'cursor-default bg-gray-50 border-gray-300' : (!form.customer_name.trim() ? 'border-red-300 bg-red-50' : 'border-gray-300')}`}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">発行会社 *</label>
            <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
              disabled={isReadOnly}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isReadOnly ? 'opacity-100 bg-gray-50 cursor-default text-gray-900 border-gray-300' : (!form.company_id ? 'border-red-300 bg-red-50' : 'border-gray-300')}`}>
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
            {categories.map((cat, idx) => {
              const isDefaultCat = DEFAULT_CATEGORIES.includes(cat)
              const catType = getCatType(cat)
              const TYPE_BADGE = { material: ['bg-orange-100 text-orange-700', '材料費系'], labor: ['bg-blue-100 text-blue-700', '労務費系'], overhead: ['bg-gray-100 text-gray-600', '共通費系'] }
              return (
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
                  {isDefaultCat ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[catType][0]}`}>{TYPE_BADGE[catType][1]}</span>
                  ) : (
                    !isReadOnly ? (
                      <select
                        value={catType}
                        onChange={e => setCategoryMeta(prev => ({ ...prev, [cat]: e.target.value }))}
                        className="text-xs border border-blue-200 rounded px-1 py-0.5 bg-white text-blue-700 focus:outline-none"
                      >
                        <option value="material">材料費系</option>
                        <option value="labor">労務費系</option>
                        <option value="overhead">共通費系</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[catType][0]}`}>{TYPE_BADGE[catType][1]}</span>
                    )
                  )}
                  {!isReadOnly && (
                    <button onClick={() => removeCategory(idx)} className="text-red-300 hover:text-red-500 ml-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {!isReadOnly && (
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="新しい大項目名"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
              />
              {[['material', '材料費系'], ['labor', '労務費系'], ['overhead', '共通費系']].map(([type, label]) => (
                <label key={type} className="flex items-center gap-1 text-xs cursor-pointer select-none">
                  <input type="radio" name="newcattype" value={type} checked={newCategoryType === type}
                    onChange={() => setNewCategoryType(type)} className="accent-blue-600" />
                  {label}
                </label>
              ))}
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

          {/* モバイル用カードレイアウト (md未満) */}
          <div className="md:hidden space-y-2">
            {[...categories, ...(items.some(i => !i.category || !categories.includes(i.category)) ? ['__others__'] : [])].map(cat => {
              const isOther = cat === '__others__'
              const catLabel = isOther ? '未分類' : cat
              const catItems = items
                .map((item, globalIdx) => ({ item, globalIdx }))
                .filter(({ item }) => isOther
                  ? (!item.category || !categories.includes(item.category))
                  : item.category === cat)
              const catSubtotal = catItems.reduce((s, { item }) => {
                if (item.is_misc_expense) return s + zaizaiAmount
                if (item.is_managed_expense) return s + getManagedAmount(item)
                return s + Number(item.amount || 0)
              }, 0)
              const inputCls = 'border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white'
              return (
                <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* カテゴリヘッダー */}
                  <div className="bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">■ {catLabel}</div>

                  {/* アイテム一覧 */}
                  {catItems.length === 0 ? (
                    <div className="px-4 py-3 text-center text-gray-400 text-xs">行がありません</div>
                  ) : catItems.map(({ item, globalIdx }, posInGroup) => {
                    const purchase_amount = Number(item.purchase_quantity || 0) * Number(item.purchase_unit_price || 0)
                    const profit_rate = item.amount > 0
                      ? Math.round(((item.amount - purchase_amount) / item.amount) * 100 * 10) / 10
                      : 0

                    // 雑材消耗品カード
                    if (item.is_misc_expense) {
                      return (
                        <div key={item.id} className="bg-amber-50 border-t border-amber-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-amber-800">雑材消耗品</span>
                              {!isReadOnly && (
                                <>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      value={item.misc_expense_rate ?? 10}
                                      onChange={e => updateItem(globalIdx, 'misc_expense_rate', Number(e.target.value))}
                                      className="w-11 text-center border border-amber-300 bg-white rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                      min="0" max="100" step="1"
                                    />
                                    <span className="text-xs text-amber-700">%</span>
                                  </div>
                                  <button
                                    onClick={() => setItems(prev => {
                                      const next = [...prev]
                                      next[globalIdx] = { ...next[globalIdx], misc_expense_manual: false }
                                      return next
                                    })}
                                    className="text-xs text-white bg-amber-500 hover:bg-amber-600 rounded px-2 py-0.5"
                                  >更新</button>
                                  {item.misc_expense_manual && (
                                    <span className="text-xs text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded">手動</span>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isReadOnly ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={fmt(zaizaiAmount)}
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const raw = Number(e.target.value.replace(/,/g, ''))
                                    if (!isNaN(raw)) {
                                      setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], amount: raw, misc_expense_manual: true }
                                        return next
                                      })
                                    }
                                  }}
                                  className="w-28 text-right border border-amber-300 bg-white rounded px-1 py-0.5 text-sm font-medium text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                />
                              ) : (
                                <span className="text-sm font-medium text-amber-800">¥{fmt(zaizaiAmount)}</span>
                              )}
                              {!isReadOnly && (
                                <button onClick={() => removeItem(globalIdx)} title="削除"
                                  className="text-red-400 hover:text-red-600 ml-1">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-xs text-amber-400">対象：材料費計 × {item.misc_expense_rate ?? 10}%</span>
                          </div>
                        </div>
                      )
                    }

                    // 共通費管理費カード
                    if (item.is_managed_expense) {
                      const managedAmt = getManagedAmount(item)
                      const baseCats = item.base_cats || ['材料費', '労務費']
                      const baseLabel = baseCats.join('＋')
                      return (
                        <div key={item.id} className="bg-indigo-50 border-t border-indigo-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-indigo-800">{item.name}</span>
                              {!isReadOnly && (
                                <>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      value={item.managed_expense_rate ?? 0}
                                      onChange={e => updateItem(globalIdx, 'managed_expense_rate', Number(e.target.value))}
                                      className="w-11 text-center border border-indigo-300 bg-white rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                      min="0" max="100" step="1"
                                    />
                                    <span className="text-xs text-indigo-700">%</span>
                                  </div>
                                  <button
                                    onClick={() => setItems(prev => {
                                      const next = [...prev]
                                      next[globalIdx] = { ...next[globalIdx], managed_expense_manual: false }
                                      return next
                                    })}
                                    className="text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded px-2 py-0.5"
                                  >更新</button>
                                  {item.managed_expense_manual && (
                                    <span className="text-xs text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">手動</span>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isReadOnly ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={fmt(managedAmt)}
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const raw = Number(e.target.value.replace(/,/g, ''))
                                    if (!isNaN(raw)) {
                                      setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], amount: raw, managed_expense_manual: true }
                                        return next
                                      })
                                    }
                                  }}
                                  className="w-28 text-right border border-indigo-300 bg-white rounded px-1 py-0.5 text-sm font-medium text-indigo-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              ) : (
                                <span className="text-sm font-medium text-indigo-800">¥{fmt(managedAmt)}</span>
                              )}
                              {!isReadOnly && (
                                <button onClick={() => removeItem(globalIdx)} title="削除"
                                  className="text-red-400 hover:text-red-600 ml-1">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="mt-1">
                            <span className="text-xs text-indigo-300">対象：{baseLabel}</span>
                          </div>
                        </div>
                      )
                    }

                    // 通常アイテムカード
                    return (
                      <div key={item.id} className={`border-t border-gray-100 px-3 py-2 ${posInGroup % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        {/* 行1: 並び替え・品名・複製・削除 */}
                        <div className="flex items-center gap-2">
                          {!isReadOnly && (
                            <div className="flex flex-col items-center gap-0 shrink-0">
                              <button onClick={() => moveItemInGroup(globalIdx, -1)} className="text-gray-400 hover:text-gray-600"><ChevronUp size={14} /></button>
                              <button onClick={() => moveItemInGroup(globalIdx, 1)} className="text-gray-400 hover:text-gray-600"><ChevronDown size={14} /></button>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            {!isReadOnly ? (
                              <input
                                value={item.name}
                                onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                className={`${inputCls} w-full`}
                                placeholder="品名"
                              />
                            ) : (
                              <span className="text-sm text-gray-800">{item.name || '　'}</span>
                            )}
                          </div>
                          {!isReadOnly && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => duplicateItem(globalIdx)} title="複製"
                                className="text-blue-400 hover:text-blue-600"><Copy size={14} /></button>
                              <button onClick={() => removeItem(globalIdx)} title="削除"
                                className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                            </div>
                          )}
                        </div>

                        {/* 行2: 仕様 */}
                        <div className="mt-1 ml-7">
                          {!isReadOnly ? (
                            <input
                              value={item.spec || ''}
                              onChange={e => updateItem(globalIdx, 'spec', e.target.value)}
                              className={`${inputCls} w-full text-xs text-gray-500`}
                              placeholder="型番・仕様"
                            />
                          ) : (
                            item.spec ? <span className="text-xs text-gray-500">{item.spec}</span> : null
                          )}
                        </div>

                        {/* 行3: 数量・単位・単価 */}
                        <div className="mt-1.5 ml-7 flex items-center gap-1">
                          {!isReadOnly ? (
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={e => updateItem(globalIdx, 'quantity', e.target.value)}
                              className={`${inputCls} w-10 text-right`}
                              min="0"
                            />
                          ) : (
                            <span className="text-sm w-10 text-right">{item.quantity}</span>
                          )}
                          {!isReadOnly ? (
                            <input
                              value={item.unit}
                              onChange={e => updateItem(globalIdx, 'unit', e.target.value)}
                              className={`${inputCls} w-12 text-center`}
                            />
                          ) : (
                            <span className="text-sm w-12 text-center">{item.unit}</span>
                          )}
                          {!isReadOnly ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              value={fmt(item.unit_price)}
                              onFocus={e => e.target.select()}
                              onChange={e => {
                                const raw = Number(e.target.value.replace(/,/g, ''))
                                if (!isNaN(raw)) updateItem(globalIdx, 'unit_price', raw)
                              }}
                              className={`${inputCls} flex-1 text-right`}
                            />
                          ) : (
                            <span className="text-sm flex-1 text-right">¥{fmt(item.unit_price)}</span>
                          )}
                        </div>
                        {/* 行4: 見積金額 */}
                        <div className="mt-0.5 ml-7 text-right">
                          <span className="font-medium text-gray-700 text-sm">¥{fmt(item.amount)}</span>
                        </div>

                        {/* 仕入エリア（横スクロール可） */}
                        <div className="mt-1 overflow-x-auto bg-gray-50 rounded px-3 py-1.5">
                          <div className="flex items-center gap-2 min-w-max">
                            <span className="text-xs text-gray-400 shrink-0">仕入</span>
                            {!isReadOnly ? (
                              <input
                                type="number"
                                value={item.purchase_quantity || 0}
                                onChange={e => updateItem(globalIdx, 'purchase_quantity', e.target.value)}
                                className={`${inputCls} w-16 text-right`}
                                min="0"
                              />
                            ) : (
                              <span className="text-sm w-16 text-right">{item.purchase_quantity || 0}</span>
                            )}
                            {!isReadOnly ? (
                              <input
                                type="number"
                                value={item.purchase_unit_price || 0}
                                onChange={e => updateItem(globalIdx, 'purchase_unit_price', e.target.value)}
                                className={`${inputCls} w-24 text-right`}
                                min="0"
                              />
                            ) : (
                              <span className="text-sm w-24 text-right">¥{fmt(item.purchase_unit_price || 0)}</span>
                            )}
                            <span className="text-sm text-gray-600 whitespace-nowrap">¥{fmt(purchase_amount)}</span>
                            <span className={`text-sm font-medium whitespace-nowrap ${profit_rate >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {fmtRate(profit_rate)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* 行追加ボタン */}
                  {!isOther && !isReadOnly && (
                    <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex items-center gap-4">
                      <button onClick={() => addItem(cat)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        <Plus size={12} /> {cat}に行を追加
                      </button>
                      {unitPriceTables.length > 0 && (
                        <button onClick={() => openUnitPriceModal(cat)}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700">
                          <List size={12} /> 単価表から追加
                        </button>
                      )}
                    </div>
                  )}

                  {/* 小計 */}
                  <div className="bg-blue-50 border-t border-blue-200 px-3 py-1.5 flex justify-end items-center gap-2">
                    <span className="text-xs text-blue-600 font-medium">■ {catLabel}　小計</span>
                    <span className="text-sm font-bold text-blue-700">¥{fmt(catSubtotal)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* デスクトップ用テーブルレイアウト (md以上) */}
          <div className="hidden md:block overflow-x-auto">
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
                const catSubtotal = catItems.reduce((s, { item }) => {
                  if (item.is_misc_expense) return s + zaizaiAmount
                  if (item.is_managed_expense) return s + getManagedAmount(item)
                  return s + Number(item.amount || 0)
                }, 0)
                return (
                  <tbody key={cat}>
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td colSpan={12} className="px-4 py-2">
                        <span className="text-sm font-semibold text-blue-800">■ {catLabel}</span>
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

                      // 雑材消耗品の特別行
                      if (item.is_misc_expense) {
                        return (
                          <tr key={item.id} className="bg-amber-50 border border-amber-200">
                            <td className="border border-gray-200 px-1 py-1"></td>
                            <td colSpan={2} className="border border-gray-200 px-3 py-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-amber-800">雑材消耗品</span>
                                {!isReadOnly && (
                                  <>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        value={item.misc_expense_rate ?? 10}
                                        onChange={e => updateItem(globalIdx, 'misc_expense_rate', Number(e.target.value))}
                                        className="w-11 text-center border border-amber-300 bg-white rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        min="0" max="100" step="1"
                                      />
                                      <span className="text-xs text-amber-700">%</span>
                                    </div>
                                    <button
                                      onClick={() => setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], misc_expense_manual: false }
                                        return next
                                      })}
                                      className="text-xs text-white bg-amber-500 hover:bg-amber-600 rounded px-2 py-0.5"
                                    >更新</button>
                                    {item.misc_expense_manual && (
                                      <span className="text-xs text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded">手動</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td colSpan={3} className="border border-gray-200 bg-amber-50 px-2">
                              <span className="text-xs text-amber-400">対象：材料費計 × {item.misc_expense_rate ?? 10}%</span>
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-right">
                              {!isReadOnly ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={fmt(zaizaiAmount)}
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const raw = Number(e.target.value.replace(/,/g, ''))
                                    if (!isNaN(raw)) {
                                      setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], amount: raw, misc_expense_manual: true }
                                        return next
                                      })
                                    }
                                  }}
                                  className="w-full text-right border border-amber-300 bg-white rounded px-1 py-0.5 text-sm font-medium text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                />
                              ) : (
                                <span className="text-sm font-medium text-amber-800">¥{fmt(zaizaiAmount)}</span>
                              )}
                            </td>
                            <td colSpan={4} className="border border-gray-200 bg-amber-50"></td>
                            <td className="border border-gray-200 px-1 py-1 text-center">
                              {!isReadOnly && (
                                <button onClick={() => removeItem(globalIdx)} title="削除"
                                  className="text-red-400 hover:text-red-600">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      }

                      // 共通費管理費の特別行
                      if (item.is_managed_expense) {
                        const managedAmt = getManagedAmount(item)
                        const baseCats = item.base_cats || ['材料費', '労務費']
                        const baseLabel = baseCats.join('＋')
                        return (
                          <tr key={item.id} className="bg-indigo-50 border border-indigo-200">
                            <td className="border border-gray-200 px-1 py-1"></td>
                            <td colSpan={2} className="border border-gray-200 px-3 py-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-indigo-800">{item.name}</span>
                                {!isReadOnly && (
                                  <>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        value={item.managed_expense_rate ?? 0}
                                        onChange={e => updateItem(globalIdx, 'managed_expense_rate', Number(e.target.value))}
                                        className="w-11 text-center border border-indigo-300 bg-white rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                        min="0" max="100" step="1"
                                      />
                                      <span className="text-xs text-indigo-700">%</span>
                                    </div>
                                    <button
                                      onClick={() => setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], managed_expense_manual: false }
                                        return next
                                      })}
                                      className="text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded px-2 py-0.5"
                                    >更新</button>
                                    {item.managed_expense_manual && (
                                      <span className="text-xs text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">手動</span>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                            <td colSpan={3} className="border border-gray-200 bg-indigo-50 px-2">
                              <span className="text-xs text-indigo-300">対象：{baseLabel}</span>
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-right">
                              {!isReadOnly ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={fmt(managedAmt)}
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const raw = Number(e.target.value.replace(/,/g, ''))
                                    if (!isNaN(raw)) {
                                      setItems(prev => {
                                        const next = [...prev]
                                        next[globalIdx] = { ...next[globalIdx], amount: raw, managed_expense_manual: true }
                                        return next
                                      })
                                    }
                                  }}
                                  className="w-full text-right border border-indigo-300 bg-white rounded px-1 py-0.5 text-sm font-medium text-indigo-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                />
                              ) : (
                                <span className="text-sm font-medium text-indigo-800">¥{fmt(managedAmt)}</span>
                              )}
                            </td>
                            <td colSpan={4} className="border border-gray-200 bg-indigo-50"></td>
                            <td className="border border-gray-200 px-1 py-1 text-center">
                              {!isReadOnly && (
                                <button onClick={() => removeItem(globalIdx)} title="削除"
                                  className="text-red-400 hover:text-red-600">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      }

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
                            <input type="text" inputMode="numeric" value={fmt(item.unit_price)}
                              onFocus={e => e.target.select()}
                              onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) updateItem(globalIdx, 'unit_price', raw) }}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" />
                          </td>
                          <td className="border border-gray-200 px-2 py-1 text-right text-sm font-medium text-gray-700">
                            ¥{fmt(item.amount)}
                          </td>
                          <td className="border border-gray-200 border-l-2 border-l-blue-200 px-1 py-1">
                            <input type="number" value={item.purchase_quantity || 0} onChange={e => updateItem(globalIdx, 'purchase_quantity', e.target.value)}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                          </td>
                          <td className="border border-gray-200 px-1 py-1">
                            <input type="text" inputMode="numeric" value={fmt(item.purchase_unit_price || 0)}
                              onFocus={e => e.target.select()}
                              onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) updateItem(globalIdx, 'purchase_unit_price', raw) }}
                              className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" />
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
                        <td colSpan={12} className="px-3 py-1.5 bg-gray-50 border-gray-200">
                          <div className="flex items-center gap-4">
                            <button onClick={() => addItem(cat)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                              <Plus size={12} /> {cat}に行を追加
                            </button>
                            {unitPriceTables.length > 0 && (
                              <button onClick={() => openUnitPriceModal(cat)}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700">
                                <List size={12} /> 単価表から追加
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className="bg-blue-50 border-t border-blue-200">
                      <td colSpan={5} className="py-1.5"></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="text-xs text-blue-600 font-medium">■ {catLabel}　小計</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="text-sm font-bold text-blue-700">¥{fmt(catSubtotal)}</span>
                      </td>
                      <td colSpan={5} className="py-1.5"></td>
                    </tr>
                  </tbody>
                )
              })}
            </table>
            </div>
          </div>

          {/* 合計エリア */}
          <div className="mt-4 flex justify-end">
            <div className="w-[480px] space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">小計</span>
                <span>¥{fmt(subtotal)}</span>
              </div>

              {/* 法定福利費 */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 whitespace-nowrap">法定福利費</span>
                <div className="flex items-center gap-1">
                  {!isReadOnly && (
                    <>
                      <input type="number" value={form.welfare_rate} min="0" max="100" step="0.1"
                        onChange={e => setForm(f => ({ ...f, welfare_rate: e.target.value, welfare_manual: false }))}
                        className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <span className="text-xs text-gray-400">% 労務費×</span>
                      {form.welfare_manual && (
                        <button onClick={() => setForm(f => ({ ...f, welfare_manual: false }))}
                          className="text-xs text-blue-600 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-gray-50">更新</button>
                      )}
                      {form.welfare_manual && (
                        <span className="text-xs text-orange-600 border border-orange-300 rounded px-1 py-0.5">手動</span>
                      )}
                    </>
                  )}
                  <span className="text-gray-400 ml-1">¥</span>
                  <input type="text" inputMode="numeric"
                    value={fmt(form.welfare_manual ? form.welfare_cost : autoWelfareCost)}
                    readOnly={isReadOnly}
                    onFocus={e => e.target.select()}
                    onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) setForm(f => ({ ...f, welfare_cost: raw, welfare_manual: true })) }}
                    className={`w-28 text-right border border-gray-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${isReadOnly ? 'cursor-default' : ''}`} />
                </div>
              </div>

              {/* 御値引き */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">御値引き</span>
                <div className="flex items-center gap-1">
                  {!isReadOnly && (
                    <>
                      <input type="number" value={form.discount_rate} min="0" max="100" step="0.1"
                        onChange={e => setForm(f => ({ ...f, discount_rate: e.target.value, discount_manual: false }))}
                        className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <span className="text-xs text-gray-400">% 小計×</span>
                      {form.discount_manual && (
                        <button onClick={() => setForm(f => ({ ...f, discount_manual: false }))}
                          className="text-xs text-blue-600 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-gray-50">更新</button>
                      )}
                      {form.discount_manual && (
                        <span className="text-xs text-orange-600 border border-orange-300 rounded px-1 py-0.5">手動</span>
                      )}
                    </>
                  )}
                  <span className="text-gray-400 ml-1">-¥</span>
                  <input type="text" inputMode="numeric"
                    value={fmt(form.discount_manual ? form.discount : autoDiscount)}
                    readOnly={isReadOnly}
                    onFocus={e => e.target.select()}
                    onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) setForm(f => ({ ...f, discount: raw, discount_manual: true })) }}
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
          {isReadOnly && (
            <>
              <button onClick={() => setShowDuplicateModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                <Copy size={15} /> 複製
              </button>
              <button onClick={() => navigate(`/quotations/${id}/print`)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                <Printer size={15} /> 印刷
              </button>
            </>
          )}
          <button onClick={() => navigate('/quotations')}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            {isReadOnly ? '一覧に戻る' : 'キャンセル'}
          </button>
          {!isReadOnly && (
            <>
              <button onClick={() => handleSave('draft')} disabled={saving || !isFormValid}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">下書き保存</button>
              <button
                onClick={() => { setSelectedApproverId(''); setShowApproverModal(true) }}
                disabled={saving || !isFormValid}
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

      {/* 複製モーダル */}
      {showDuplicateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-800 mb-1">複製方法を選択</h3>
            <p className="text-xs text-gray-500 mb-5">{quotationMeta.number}「{form.title}」</p>
            <div className="space-y-3">
              <button onClick={() => handleDuplicate('revision')} disabled={duplicating}
                className="w-full text-left px-4 py-3 border-2 border-blue-200 bg-blue-50 rounded-xl hover:border-blue-400 hover:bg-blue-100 transition-colors disabled:opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-white bg-blue-500 px-2 py-0.5 rounded-full">修正</span>
                  <span className="text-xs text-blue-600 font-medium">同一見積の改訂版</span>
                </div>
                <div className="text-xs text-blue-700">
                  見積番号を引き継いだ修正版として作成します。<br />
                  例：{quotationMeta.baseNumber}-{quotationMeta.revisionNumber + 1}
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
            <button onClick={() => setShowDuplicateModal(false)} disabled={duplicating}
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

      {/* 単価表モーダル */}
      {showUnitPriceModal !== null && (() => {
        const cat = showUnitPriceModal
        // このカテゴリの品目を持つ単価表のみ表示
        const filteredTables = unitPriceTables.filter(t =>
          !tableCategoryMap[t.id] || tableCategoryMap[t.id].has(cat)
        )
        const displayItems = upModalAllItems.filter(up =>
          !upModalSearch ||
          up.name.toLowerCase().includes(upModalSearch.toLowerCase()) ||
          (up.spec || '').toLowerCase().includes(upModalSearch.toLowerCase())
        )
        const allChecked = displayItems.length > 0 && displayItems.every(i => upModalCheckedIds.has(i.id))

        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
              {/* ヘッダー */}
              <div className="flex items-center justify-between p-4 border-b shrink-0">
                <div className="flex items-center gap-2">
                  {upModalStep === 'items' && (
                    <button onClick={() => setUpModalStep('tables')} className="text-gray-400 hover:text-gray-700 text-sm mr-1">← 戻る</button>
                  )}
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      {upModalStep === 'tables' ? '単価表を選択' : '品目を選択'}
                    </h3>
                    <p className="text-xs text-gray-400">{cat}</p>
                  </div>
                </div>
                <button onClick={() => setShowUnitPriceModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>

              {/* テーブル選択ステップ */}
              {upModalStep === 'tables' && (
                <>
                  <div className="overflow-y-auto flex-1 p-2">
                    {filteredTables.length === 0 ? (
                      <p className="text-center text-gray-400 py-10 text-sm">該当する単価表がありません</p>
                    ) : (
                      filteredTables.map(table => {
                        const checked = upModalSelectedTableIds.has(table.id)
                        return (
                          <label key={table.id}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer hover:bg-blue-50 ${checked ? 'bg-blue-50' : ''}`}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleTableId(table.id)}
                              className="w-4 h-4 accent-blue-600 shrink-0" />
                            <span className="text-sm font-medium text-gray-800">{table.name}</span>
                          </label>
                        )
                      })
                    )}
                  </div>
                  <div className="p-4 border-t shrink-0">
                    <button
                      onClick={loadUnitPriceItems}
                      disabled={upModalSelectedTableIds.size === 0}
                      className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40"
                    >
                      {upModalSelectedTableIds.size > 0
                        ? `${upModalSelectedTableIds.size}件の単価表から品目を選ぶ →`
                        : '単価表を選択してください'}
                    </button>
                  </div>
                </>
              )}

              {/* 品目選択ステップ */}
              {upModalStep === 'items' && (
                <>
                  <div className="px-4 py-2 border-b shrink-0">
                    <input
                      value={upModalSearch}
                      onChange={e => setUpModalSearch(e.target.value)}
                      placeholder="品名・仕様で検索"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                  {!upModalLoading && displayItems.length > 0 && (
                    <div className="px-4 py-1.5 border-b bg-gray-50 shrink-0">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={allChecked}
                          onChange={() => {
                            if (allChecked) {
                              setUpModalCheckedIds(prev => {
                                const next = new Set(prev)
                                displayItems.forEach(i => next.delete(i.id))
                                return next
                              })
                            } else {
                              setUpModalCheckedIds(prev => {
                                const next = new Set(prev)
                                displayItems.forEach(i => next.add(i.id))
                                return next
                              })
                            }
                          }}
                          className="w-4 h-4 accent-blue-600" />
                        <span className="text-xs text-gray-500">すべて選択</span>
                      </label>
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1 p-2">
                    {upModalLoading ? (
                      <p className="text-center text-gray-400 py-10 text-sm">読み込み中...</p>
                    ) : displayItems.length === 0 ? (
                      <p className="text-center text-gray-400 py-10 text-sm">該当なし</p>
                    ) : (
                      displayItems.map(up => {
                        const checked = upModalCheckedIds.has(up.id)
                        return (
                          <label key={up.id}
                            className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer hover:bg-blue-50 ${checked ? 'bg-blue-50' : ''}`}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleItemId(up.id)}
                              className="w-4 h-4 accent-blue-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{up.name}</p>
                              {up.spec && <p className="text-xs text-gray-500 truncate">{up.spec}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-blue-700">¥{fmt(up.price)}</p>
                              <p className="text-xs text-gray-400">{up.unit}</p>
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                  <div className="p-4 border-t shrink-0">
                    <button
                      onClick={addFromUnitPriceMulti}
                      disabled={upModalCheckedIds.size === 0}
                      className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40"
                    >
                      {upModalCheckedIds.size > 0
                        ? `${upModalCheckedIds.size}件を${cat}に追加`
                        : '品目を選択してください'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
