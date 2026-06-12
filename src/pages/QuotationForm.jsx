import { useState, useEffect, useRef, Fragment as ReactFragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Trash2, ChevronUp, ChevronDown, Copy, List, Printer, GripVertical, Pencil, Upload } from 'lucide-react'
import { useDragAutoScroll } from '../hooks/useDragAutoScroll'

const GREETING = '毎度御引立て賜り、誠に有難う御座います。\n下記の通り御見積申しあげます。'
const DEFAULT_CATEGORIES = ['材料費', '労務費', '共通費']
// 既定の英語名（材料/労務/共通費）
const CAT_EN_DEFAULTS = {
  '材料費': 'Premium Materials',
  '労務費': 'Expert Labor',
  '共通費': 'Management & Overheads',
}
// 特殊行・合計行の表示名デフォルト
const SPECIAL_LABELS_DEFAULTS = {
  misc: '雑材消耗品',
  welfare: '法定福利費',
  discount: '御値引き',
}

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

// role ↔ 日本語名 / 英語名
const ROLE_TO_JP = { genba: '現場管理費', ippan: '一般管理費', anzen: '安全対策費', shokei: '諸経費' }
const ROLE_TO_EN = { genba: 'Site Management', ippan: 'General Admin', anzen: 'Safety Cost', shokei: 'Misc Expenses' }

const MANAGED_DEFAULTS = [
  { role: 'genba',  name: '現場管理費', rate: 15, base_cats: ['材料費', '労務費'] },
  { role: 'ippan',  name: '一般管理費', rate: 10, base_cats: ['材料費', '労務費'] },
  { role: 'anzen',  name: '安全対策費', rate: 3,  base_cats: ['労務費'] },
  { role: 'shokei', name: '諸経費',     rate: 3,  base_cats: ['材料費', '労務費', '共通費'] },
]
// name に含まれる日本語キーワードから role を推定（英日併記・前置きありでも対応）
function inferManagedRole(name = '') {
  if (name.includes('現場管理')) return 'genba'
  if (name.includes('一般管理')) return 'ippan'
  if (name.includes('安全対策') || name.includes('安全管理')) return 'anzen'
  if (name.includes('諸経費')) return 'shokei'
  return 'custom'
}
// 管理費の表示名：default role は role から導出（英語表記ONなら "EN / JP"）、custom は素のname
function managedDisplayName(item, showEnglish) {
  const role = item.managed_role
  if (role && ROLE_TO_JP[role]) {
    const jp = ROLE_TO_JP[role]
    return showEnglish ? `${ROLE_TO_EN[role]} / ${jp}` : jp
  }
  return item.name || ''
}

const managedExpenseItem = (name, rate, base_cats = ['材料費', '労務費'], role = 'custom') => ({
  ...emptyItem('共通費'),
  name,
  is_managed_expense: true,
  managed_expense_rate: rate,
  managed_expense_manual: false,
  base_cats,
  managed_role: role,
})

const emptySubCategoryItem = (category = '', name = '') => ({
  id: crypto.randomUUID(),
  sort_order: 0,
  name,
  spec: '__subcategory__',
  description: '',
  category,
  quantity: 0,
  unit: '',
  unit_price: 0,
  amount: 0,
  purchase_quantity: 0,
  purchase_unit_price: 0,
  is_sub_category_header: true,
})

// 数量がテキスト入力（「支給品」「既設」等）かどうか判定
const isTextQty = (qty) => typeof qty === 'string' && qty !== '' && isNaN(parseFloat(qty))

function calcItem(item) {
  const qty = isTextQty(item.quantity) ? 0 : (parseFloat(item.quantity) || 0)
  const amount = qty * Number(item.unit_price)
  const purchase_amount = Number(item.purchase_quantity) * Number(item.purchase_unit_price)
  const profit = amount - purchase_amount
  const profit_rate = amount > 0 ? Math.round((profit / amount) * 100 * 10) / 10 : 0
  return { ...item, amount, purchase_amount, profit, profit_rate }
}

export default function QuotationForm() {
  const { id: urlId } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin, isApprover, isSuperAdmin } = useAuth()
  // 自動下書き保存で作成された見積ID（URL遷移せず内部で保持）
  const [createdId, setCreatedId] = useState(null)
  const id = urlId || createdId
  const isEdit = !!id

  const [customers, setCustomers] = useState([])
  const [companies, setCompanies] = useState([])
  const [unitPriceTables, setUnitPriceTables] = useState([])
  const [taxRate, setTaxRate] = useState(10)
  const [saving, setSaving] = useState(false)
  const [quotationStatus, setQuotationStatus] = useState(null)
  const [quotationCreatedBy, setQuotationCreatedBy] = useState(null)
  const [cancelRequestModal, setCancelRequestModal] = useState(false)
  const [showUnitPriceModal, setShowUnitPriceModal] = useState(null) // カテゴリ名 or null
  // 仕入CSV取り込みモーダル
  const [showCsvImportModal, setShowCsvImportModal] = useState(false)
  const [csvImportStep, setCsvImportStep] = useState('input') // 'input' | 'preview'
  const [csvImportText, setCsvImportText] = useState('')
  const [csvImportRows, setCsvImportRows] = useState([]) // [{include, category, name, spec, quantity, unit, purchase_quantity, purchase_unit_price}]
  const [csvImportError, setCsvImportError] = useState('')
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
  const [checkedItemIds, setCheckedItemIds] = useState(new Set())
  const [showUPRegisterModal, setShowUPRegisterModal] = useState(false)
  const [upRegisterTableId, setUpRegisterTableId] = useState('')
  const [upRegisterDuplicates, setUpRegisterDuplicates] = useState([])
  const [upRegisterDecisions, setUpRegisterDecisions] = useState({})
  const [upRegisterStep, setUpRegisterStep] = useState('selectTable')
  const [upRegisterSaving, setUpRegisterSaving] = useState(false)
  const [requestedApproverId, setRequestedApproverId] = useState(null)
  const [approvalModal, setApprovalModal] = useState(null) // 'approve' | 'reject' | null
  const [approvalComment, setApprovalComment] = useState('')
  const [approvalProcessing, setApprovalProcessing] = useState(false)
  const [quotationMeta, setQuotationMeta] = useState({ number: '', baseNumber: '', revisionNumber: 1 })
  const [autoSavedAt, setAutoSavedAt] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [pendingRestore, setPendingRestore] = useState(null)
  const formInitialized = useRef(false)
  const upModalScrollRef = useRef(null)
  const [dragItemId,     setDragItemId]     = useState(null)
  const [dragItemOverId, setDragItemOverId] = useState(null)
  // ドラッグハンドル（左端のグリップ）からだけドラッグ開始を許可する
  const [dragHandleActiveId, setDragHandleActiveId] = useState(null)
  // グリップから手を離したらリセット（mouseup を window で拾う）
  useEffect(() => {
    const onUp = () => setDragHandleActiveId(null)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  useDragAutoScroll()

  const [categories, setCategories] = useState([...DEFAULT_CATEGORIES])
  const [categoryMeta, setCategoryMeta] = useState({}) // { catName: 'material' | 'labor' | 'overhead' }
  const [categoryEnNames, setCategoryEnNames] = useState({}) // { catName: 'English Name' }（'' で明示的に英語なし）
  const [categoryDisplayNames, setCategoryDisplayNames] = useState({}) // { canonical(材料費等): '表示名' } — 既定カテゴリ用
  const [showSubSubtotals, setShowSubSubtotals] = useState(false) // 中項目ごとの小計を表示するか（全体ON/OFF）
  const [showEnglishLabels, setShowEnglishLabels] = useState(false) // 管理費を英日併記＋単位LS表記にするか
  const [saveToast, setSaveToast] = useState('')
  // 法定福利費・値引きの表示名カスタマイズ
  const [welfareLabel, setWelfareLabel] = useState(SPECIAL_LABELS_DEFAULTS.welfare)
  const [discountLabel, setDiscountLabel] = useState(SPECIAL_LABELS_DEFAULTS.discount)
  const [renamingWelfare, setRenamingWelfare] = useState(false)
  const [renamingDiscount, setRenamingDiscount] = useState(false)
  const [renamingItemId, setRenamingItemId] = useState(null) // 雑材消耗品 / 管理費の名称編集中ID
  const [newCategoryType, setNewCategoryType] = useState('overhead')
  const [renamingCatIdx, setRenamingCatIdx] = useState(null)
  const [renamingCatValue, setRenamingCatValue] = useState('')
  const [discountDraft, setDiscountDraft] = useState(null) // 入力中の値（null=確定済み）
  const discountTimerRef = useRef(null)

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
    // 材料費の空欄行は不要（行がありませんを表示）
    miscExpenseItem(),
    ...MANAGED_DEFAULTS.map(({ name, rate, base_cats, role }) => managedExpenseItem(name, rate, base_cats, role)),
  ])

  useEffect(() => {
    fetchMasterData()
    // URLのidがある場合のみ初回ロード（自動保存で作られた createdId では再ロードしない）
    if (urlId) loadQuotation()
  }, [urlId])

  // 自動保存（変更から3秒後にlocalStorageへ）
  const draftKey = `tenx_rfq_draft_${id || 'new'}`
  useEffect(() => {
    if (!formInitialized.current) return
    const isRO = ['approved', 'rejected', 'pending_approval'].includes(quotationStatus)
    if (isRO) return
    setHasUnsavedChanges(true)
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          form, items, categories, categoryMeta,
          savedAt: new Date().toISOString(),
          quotationId: id || null,
        }))
        setAutoSavedAt(new Date())
      } catch (e) {
        console.error('Auto-save failed:', e)
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [form, items, categories, categoryMeta])

  // DB自動下書き保存
  // 1) 件名+顧客が初めて揃った瞬間に即保存（すぐ一覧に出る）
  // 2) 以降の変更は5秒デバウンスで更新
  const didInitialDbSave = useRef(false)
  useEffect(() => {
    if (!formInitialized.current) return
    const isRO = ['approved', 'rejected', 'pending_approval'].includes(quotationStatus)
    if (isRO) return
    if (!form.title?.trim()) return
    const hasCustomer = form.customer_id === '__direct__'
      ? !!form.customer_name?.trim()
      : !!form.customer_id
    if (!hasCustomer) return

    if (!didInitialDbSave.current) {
      // 初回：即保存
      didInitialDbSave.current = true
      handleSave('draft', null, { silent: true }).catch(e => console.error('DB auto-save failed:', e))
      return
    }
    // 2回目以降：5秒デバウンス
    const timer = setTimeout(() => {
      handleSave('draft', null, { silent: true }).catch(e => console.error('DB auto-save failed:', e))
    }, 5000)
    return () => clearTimeout(timer)
  }, [form, items, categories, categoryMeta, categoryEnNames, categoryDisplayNames])

  // ページ離脱警告
  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  async function fetchMasterData() {
    const [{ data: cust }, { data: comp }, { data: tables }, { data: stg }] = await Promise.all([
      supabase.from('customers').select('id, name').order('sort_order', { nullsFirst: false }).order('name'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('unit_price_tables').select('*').order('sort_order', { nullsFirst: false }).order('created_at'),
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
          ...(def.delivery_default !== undefined && { delivery_terms: def.delivery_default }),
          ...(def.payment_default !== undefined && { payment_terms: def.payment_default }),
          ...(def.validity_default !== undefined && { validity_period: def.validity_default }),
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
    // 新規作成時: 下書きがあれば復元を提案
    if (!isEdit) {
      setTimeout(() => {
        formInitialized.current = true
        const saved = localStorage.getItem('tenx_rfq_draft_new')
        if (saved) {
          try {
            const draft = JSON.parse(saved)
            if (draft.savedAt) { setPendingRestore(draft); setShowRestoreModal(true) }
          } catch {}
        }
      }, 100)
    }
  }

  // 下書き復元
  function handleRestore() {
    if (!pendingRestore) return
    setForm(pendingRestore.form)
    setItems(pendingRestore.items)
    setCategories(pendingRestore.categories || [...DEFAULT_CATEGORIES])
    setCategoryMeta(pendingRestore.categoryMeta || {})
    setShowRestoreModal(false)
    setPendingRestore(null)
  }

  // 画面から直接 承認 / 差し戻し
  async function handleDirectApproval(action) {
    setApprovalProcessing(true)
    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    // 特権管理者が承認待ちを直接編集していた場合、承認前に修正内容を保存
    if (action === 'approve' && canEditPending) {
      try {
        await handleSave('pending_approval', requestedApproverId, { silent: true })
      } catch (e) {
        console.error('承認前の修正保存に失敗:', e)
      }
    }
    await supabase.from('quotations').update({
      status: newStatus,
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
      ...(approvalComment.trim() ? { approval_comment: approvalComment.trim() } : {}),
    }).eq('id', id)
    supabase.functions.invoke('notify-requester', {
      body: { quotation_id: id, action, comment: approvalComment.trim(), approver_id: profile.id },
    }).catch(e => console.error('notify-requester error:', e))
    setQuotationStatus(newStatus)
    setApprovalModal(null)
    setApprovalComment('')
    setApprovalProcessing(false)
  }

  function toggleItemCheck(item) {
    if (!item.name.trim()) return
    setCheckedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        if (checkedCategory !== null && item.category !== checkedCategory) return prev
        next.add(item.id)
      }
      return next
    })
  }

  async function handleOpenUPRegisterModal() {
    setUpRegisterStep('selectTable')
    setUpRegisterTableId(unitPriceTables[0]?.id || '')
    setUpRegisterDecisions({})
    setUpRegisterDuplicates([])
    setShowUPRegisterModal(true)
  }

  async function handleUPRegisterConfirm() {
    if (!upRegisterTableId) return
    setUpRegisterSaving(true)
    const { data: existing } = await supabase.from('unit_prices').select('*').eq('table_id', upRegisterTableId)
    const existingByName = {}
    ;(existing || []).forEach(up => { existingByName[up.name] = up })
    const duplicates = checkedItems.filter(item => existingByName[item.name]).map(item => ({ item, existing: existingByName[item.name] }))
    setUpRegisterSaving(false)
    if (duplicates.length > 0) {
      setUpRegisterDuplicates(duplicates)
      const decisions = {}
      duplicates.forEach(({ item }) => { decisions[item.id] = null })
      setUpRegisterDecisions(decisions)
      setUpRegisterStep('confirmDuplicates')
    } else {
      await doUPRegister({})
    }
  }

  async function doUPRegister(decisions) {
    setUpRegisterSaving(true)
    const { data: existing } = await supabase.from('unit_prices').select('*').eq('table_id', upRegisterTableId)
    const existingByName = {}
    ;(existing || []).forEach(up => { existingByName[up.name] = up })
    for (const item of checkedItems) {
      const upData = { table_id: upRegisterTableId, name: item.name, spec: item.spec || null, unit: item.unit, price: Number(item.unit_price), buy_price: Number(item.purchase_unit_price || 0), category: item.category, created_by: profile.id }
      const existingItem = existingByName[item.name]
      const decision = decisions[item.id] || 'overwrite'
      if (existingItem && decision === 'overwrite') {
        await supabase.from('unit_prices').update(upData).eq('id', existingItem.id)
      } else {
        await supabase.from('unit_prices').insert(upData)
      }
    }
    setUpRegisterSaving(false)
    setShowUPRegisterModal(false)
    setCheckedItemIds(new Set())
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
      .from('unit_prices').select('*, unit_price_tables!inner(name)')
      .in('table_id', ids)
      .order('sort_order', { nullsFirst: false })
      .order('category')
      .order('name')
    // 開いたカテゴリと同じ型の品目のみ表示（材料費→材料費系、労務費→労務費系…）
    const destCat = showUnitPriceModal
    const destType = destCat ? getCatType(destCat) : null
    const tableOrder = unitPriceTables.map(t => t.id)
    const CATEGORY_ORDER = ['材料費', '労務費', '共通費']
    const catRank = (cat) => {
      const idx = CATEGORY_ORDER.indexOf(cat)
      return idx >= 0 ? idx : CATEGORY_ORDER.length
    }
    const filtered = (data || [])
      .map(i => ({ ...i, _tableName: i.unit_price_tables?.name || '' }))
      .filter(i => {
        if (!destType) return true
        // 単価表内の品目の category は '材料費'/'労務費'/'共通費' 等。getCatType で型に変換して比較
        const itemType = getCatType(i.category)
        return itemType === destType
      })
      .sort((a, b) => {
        const ai = tableOrder.indexOf(a.table_id)
        const bi = tableOrder.indexOf(b.table_id)
        if (ai !== bi) return ai - bi
        const ca = catRank(a.category), cb = catRank(b.category)
        if (ca !== cb) return ca - cb
        if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '')
        return (a.sort_order ?? 999999) - (b.sort_order ?? 999999)
      })
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
    const { data: q } = await supabase.from('quotations').select('*').eq('id', urlId).single()
    if (!q) return
    setQuotationStatus(q.status)
    setQuotationCreatedBy(q.created_by || null)
    setRequestedApproverId(q.requested_approver_id || null)
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
          if (parsed.en_names) setCategoryEnNames(parsed.en_names)
          if (parsed.display_names) setCategoryDisplayNames(parsed.display_names)
          if (typeof parsed.show_sub_subtotals === 'boolean') setShowSubSubtotals(parsed.show_sub_subtotals)
          if (typeof parsed.show_english_labels === 'boolean') setShowEnglishLabels(parsed.show_english_labels)
          if (parsed.item_labels) {
            if (parsed.item_labels.welfare) setWelfareLabel(parsed.item_labels.welfare)
            if (parsed.item_labels.discount) setDiscountLabel(parsed.item_labels.discount)
          }
        }
      } catch {}
    }
    const { data: its } = await supabase
      .from('quotation_items').select('*').eq('quotation_id', id).order('sort_order')
    if (its?.length) {

      // 旧データ（spec='__subcategory__:1'）が混在していたら、グローバル設定を ON に引き上げる
      const hasLegacySubFlag = its.some(i => i.spec === '__subcategory__:1')
      if (hasLegacySubFlag) setShowSubSubtotals(true)

      const mappedItems = its.map(i => {
        const is_managed_expense = i.spec?.startsWith('__managed__:')
        const is_sub_category_header = i.spec === '__subcategory__' || i.spec?.startsWith('__subcategory__:')
        let managed_expense_rate = 0, base_cats = ['材料費', '労務費'], managed_role = 'custom'
        if (is_managed_expense) {
          const parts = i.spec.split(':')
          managed_expense_rate = Number(parts[1]) || 0
          base_cats = parts[2] ? parts[2].split(',') : ['材料費', '労務費']
          managed_role = parts[3] || inferManagedRole(i.name)  // role が無ければ name から推定（部分一致）
        }
        // 管理費の手入力フラグ（spec の :M マーカー）
        const managed_expense_manual = is_managed_expense && i.spec.split(':')[4] === 'M'
        // 雑材消耗品：新フォーマット (__misc__:rate[:M]) または旧フォーマット (name === '雑材消耗品' && spec が数値)
        const isMiscNewFormat = i.spec?.startsWith('__misc__:')
        const isMiscLegacy = !is_managed_expense && !is_sub_category_header
          && i.name === '雑材消耗品' && i.category === '材料費'
          && i.spec != null && !isNaN(Number(i.spec))
        const is_misc_expense = isMiscNewFormat || isMiscLegacy
        const miscParts = isMiscNewFormat ? i.spec.split(':') : []
        const misc_expense_rate = is_misc_expense
          ? (isMiscNewFormat ? (Number(miscParts[1]) || 10) : (Number(i.spec) || 10))
          : 10
        // 雑材消耗品の手入力フラグ（spec の :M マーカー）
        const misc_expense_manual = isMiscNewFormat && miscParts[2] === 'M'
        const specVal = (is_misc_expense || is_managed_expense || is_sub_category_header) ? '' : (i.spec || '')
        const qtyText = i.description?.startsWith('qty_text:') ? i.description.slice(9) : null
        // 既定roleの管理費は name を日本語に正規化（過去の英日併記ポリュートを除去）
        const normalizedName = (is_managed_expense && ROLE_TO_JP[managed_role])
          ? ROLE_TO_JP[managed_role]
          : i.name
        const base = {
          ...emptyItem(), ...i, id: i.id || crypto.randomUUID(),
          name: normalizedName,
          is_misc_expense, misc_expense_rate, misc_expense_manual,
          is_managed_expense, managed_expense_rate, managed_expense_manual, managed_role,
          is_sub_category_header,
          base_cats, spec: specVal,
          quantity: qtyText ?? i.quantity,
          description: qtyText ? '' : (i.description || ''),
        }
        return (is_misc_expense || is_managed_expense || is_sub_category_header) ? base : calcItem(base)
      })

      // 雑材消耗品・管理費は「新規作成時の初期補助」のみ。
      // 保存済みの見積を読み込むときは、保存された内容を厳密に尊重する
      // （削除されていれば削除のまま、変更されていれば変更のまま。自動補完・再追加は一切しない）
      setItems(mappedItems)
    }
    // 初期化完了 → 自動保存開始
    setTimeout(() => {
      formInitialized.current = true
      // 編集モードで下書きがあれば復元を提案（承認/差し戻し済みは除く）
      const isRO = ['approved', 'rejected', 'pending_approval'].includes(q.status)
      if (!isRO) {
        const saved = localStorage.getItem(`tenx_rfq_draft_${id}`)
        if (saved) {
          try {
            const draft = JSON.parse(saved)
            if (draft.savedAt) { setPendingRestore(draft); setShowRestoreModal(true) }
          } catch {}
        }
      }
    }, 100)
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
    if (!name || categories.includes(name) || categories.length >= 10) return
    setCategories(prev => {
      const kyotsuIdx = prev.indexOf('共通費')
      const next = [...prev]
      kyotsuIdx !== -1 ? next.splice(kyotsuIdx, 0, name) : next.push(name)
      return next
    })
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
      const kyotsuIdx = prev.indexOf('共通費')
      if (kyotsuIdx !== -1 && (idx === kyotsuIdx || idx + dir === kyotsuIdx)) return prev
      const next = [...prev]
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  function renameCategory(idx, newName) {
    const trimmed = newName.trim()
    const oldName = categories[idx]
    if (!trimmed || trimmed === oldName || categories.some((c, i) => i !== idx && c === trimmed)) return
    setCategories(prev => prev.map((c, i) => i === idx ? trimmed : c))
    setCategoryMeta(prev => {
      const next = { ...prev }
      if (next[oldName] !== undefined) { next[trimmed] = next[oldName]; delete next[oldName] }
      return next
    })
    setCategoryEnNames(prev => {
      const next = { ...prev }
      if (next[oldName] !== undefined) { next[trimmed] = next[oldName]; delete next[oldName] }
      return next
    })
    setItems(prev => prev.map(item => item.category === oldName ? { ...item, category: trimmed } : item))
    setRenamingCatIdx(null)
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
      if (field === 'quantity' && !isTextQty(value) && Number(next[idx].purchase_quantity) === Number(next[idx].quantity)) {
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

  function handleItemDrop(targetItem) {
    if (!dragItemId || dragItemId === targetItem.id) return
    setItems(prev => {
      const draggedItem = prev.find(i => i.id === dragItemId)
      if (!draggedItem || draggedItem.category !== targetItem.category) return prev
      // 中項目1つ目は移動禁止
      const firstSubHeader = prev.find(i => i.category === draggedItem.category && i.is_sub_category_header)
      if (firstSubHeader && firstSubHeader.id === draggedItem.id) return prev
      // 中項目1つ目より前への挿入禁止
      if (firstSubHeader) {
        const firstSubIdx = prev.findIndex(i => i.id === firstSubHeader.id)
        const targetIdx = prev.findIndex(i => i.id === targetItem.id)
        if (targetIdx <= firstSubIdx) return prev
      }
      const fromIdx = prev.findIndex(i => i.id === dragItemId)
      const toIdx   = prev.findIndex(i => i.id === targetItem.id)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = [...prev]
      next.splice(fromIdx, 1)
      const newToIdx = next.findIndex(i => i.id === targetItem.id)
      next.splice(newToIdx, 0, draggedItem)
      return next.map((item, i) => ({ ...item, sort_order: i }))
    })
  }

  function addSubCategoryItem(category = '') {
    setItems(prev => {
      const newItem = { ...emptySubCategoryItem(category, ''), sort_order: prev.length }
      const hasSubHeader = prev.some(i => i.category === category && i.is_sub_category_header)
      if (!hasSubHeader) {
        // 1つ目の中項目：カテゴリの先頭に挿入
        const firstCatIdx = prev.findIndex(i => i.category === category)
        const next = [...prev]
        next.splice(firstCatIdx !== -1 ? firstCatIdx : prev.length, 0, newItem)
        return next.map((item, i) => ({ ...item, sort_order: i }))
      }
      // 2つ目以降：固定行の直前、なければ末尾
      const fixedIdx = prev.findIndex(i => (i.is_misc_expense || i.is_managed_expense) && i.category === category)
      if (fixedIdx !== -1) {
        const next = [...prev]
        next.splice(fixedIdx, 0, newItem)
        return next.map((item, i) => ({ ...item, sort_order: i }))
      }
      return [...prev, newItem].map((item, i) => ({ ...item, sort_order: i }))
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

  // ===== 仕入CSV取り込み =====
  function parseCsvSimple(text) {
    const raw = (text || '').replace(/^﻿/, '').trim()
    if (!raw) return []
    const lines = raw.split(/\r?\n/).filter(l => l.trim())
    const rows = []
    for (const line of lines) {
      const cells = []
      let cur = '', inQuote = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQuote) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
          else if (ch === '"') { inQuote = false }
          else cur += ch
        } else {
          if (ch === '"') inQuote = true
          else if (ch === ',') { cells.push(cur.trim()); cur = '' }
          else cur += ch
        }
      }
      cells.push(cur.trim())
      rows.push(cells)
    }
    return rows
  }

  // 簡易キーワード判別（フォールバック）
  function classifyByKeyword(name = '', spec = '') {
    const t = (name + ' ' + spec).toLowerCase()
    const laborKW = /(工事|作業|施工|設計|設置|収容|交換|撤去|配線|データ投入|設定|人工|労務|現地|出張)/
    const overheadKW = /(運搬|交通|諸経費|管理費|安全|現場管理|廃材|処分|宿泊|試験|調整|雑材)/
    if (laborKW.test(t)) return '労務費'
    if (overheadKW.test(t)) return '共通費'
    return '材料費'
  }

  function normalizeCategory(raw) {
    if (!raw) return ''
    const t = String(raw).trim()
    if (categories.includes(t)) return t
    // 部分一致で標準カテゴリにフォールバック
    if (/材料/.test(t)) return '材料費'
    if (/労務|人工|工事/.test(t)) return '労務費'
    if (/共通|諸経/.test(t)) return '共通費'
    return ''
  }

  function handleParseCsv() {
    setCsvImportError('')
    const rows = parseCsvSimple(csvImportText)
    if (rows.length === 0) {
      setCsvImportError('CSVが空です。テキストを貼り付けてください。')
      return
    }
    // ヘッダー検出
    const header = rows[0].map(h => h.replace(/\s/g, ''))
    const dataRows = /^カテゴリ|^category/i.test(header[0]) ? rows.slice(1) : rows

    // 列のインデックスをヘッダーから決定（無ければ固定順）
    const idx = (...keys) => {
      for (const k of keys) {
        const i = header.findIndex(h => h === k)
        if (i >= 0) return i
      }
      return -1
    }
    const iCat = idx('カテゴリ', 'category')
    const iName = idx('品名', 'name')
    const iSpec = idx('仕様', 'spec')
    const iQty = idx('数量', 'quantity', 'qty')
    const iUnit = idx('単位', 'unit')
    const iPQty = idx('仕入数量', 'purchase_quantity')
    const iPPrice = idx('仕入単価', 'purchase_unit_price')

    const parsed = dataRows
      .filter(r => r.some(c => c.trim()))
      .map(r => {
        const getCell = (i, fallback) => i >= 0 ? (r[i] || '') : (r[fallback] || '')
        const rawCat = getCell(iCat, 0)
        const name = getCell(iName, 1).trim()
        const spec = getCell(iSpec, 2).trim()
        const quantity = getCell(iQty, 3).replace(/,/g, '').trim()
        const unit = getCell(iUnit, 4).trim()
        const pQty = getCell(iPQty, 5).replace(/,/g, '').trim()
        const pPrice = getCell(iPPrice, 6).replace(/,/g, '').trim()
        let category = normalizeCategory(rawCat)
        let confidence = 'high'
        if (!category) {
          category = classifyByKeyword(name, spec)
          confidence = 'low'
        }
        return {
          include: !!name,
          category,
          name,
          spec,
          quantity,
          unit: unit || '式',
          purchase_quantity: pQty || quantity,
          purchase_unit_price: pPrice ? Number(pPrice) : 0,
          confidence,
        }
      })
      .filter(r => r.name)
    if (parsed.length === 0) {
      setCsvImportError('有効な明細が見つかりませんでした。CSVのフォーマットを確認してください。')
      return
    }
    setCsvImportRows(parsed)
    setCsvImportStep('preview')
  }

  function updateCsvRow(idx, field, value) {
    setCsvImportRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  function setAllCsvCategory(cat) {
    setCsvImportRows(prev => prev.map(r => ({ ...r, category: cat })))
  }

  function setAllCsvInclude(include) {
    setCsvImportRows(prev => prev.map(r => ({ ...r, include })))
  }

  function handleConfirmCsvImport() {
    const selected = csvImportRows.filter(r => r.include && r.name && r.category)
    if (selected.length === 0) {
      setCsvImportError('取り込む明細がありません。')
      return
    }
    setItems(prev => {
      const next = [...prev]
      // カテゴリごとに固まりとして挿入
      const byCat = {}
      selected.forEach(r => { (byCat[r.category] ||= []).push(r) })
      Object.entries(byCat).forEach(([cat, rows]) => {
        const newItems = rows.map(r => calcItem({
          ...emptyItem(cat),
          name: r.name,
          spec: r.spec,
          quantity: r.quantity === '' ? '' : (isNaN(Number(r.quantity)) ? r.quantity : Number(r.quantity)),
          unit: r.unit,
          unit_price: 0,
          purchase_quantity: r.purchase_quantity === '' ? '' : (isNaN(Number(r.purchase_quantity)) ? r.purchase_quantity : Number(r.purchase_quantity)),
          purchase_unit_price: Number(r.purchase_unit_price) || 0,
        }))
        // 固定行（misc/managed）の直前、なければカテゴリ末尾、なければ最後尾へ
        const firstFixedIdx = next.findIndex(i => (i.is_misc_expense || i.is_managed_expense) && i.category === cat)
        const catIndices = next
          .map((item, i) => ({ item, i }))
          .filter(({ item }) => item.category === cat && !item.is_misc_expense && !item.is_managed_expense)
          .map(({ i }) => i)
        const insertAt = firstFixedIdx !== -1 ? firstFixedIdx : (catIndices.length > 0 ? catIndices[catIndices.length - 1] + 1 : next.length)
        next.splice(insertAt, 0, ...newItems)
      })
      return next.map((item, i) => ({ ...item, sort_order: i }))
    })
    // モーダルを閉じてリセット
    setShowCsvImportModal(false)
    setCsvImportStep('input')
    setCsvImportText('')
    setCsvImportRows([])
    setCsvImportError('')
  }

  function addFromUnitPriceMulti() {
    const cat = showUnitPriceModal
    const selected = [...upModalCheckedIds].map(id => upModalAllItems.find(i => i.id === id)).filter(Boolean)
    if (selected.length === 0) return
    setItems(prev => {
      const newRows = selected.map(up => {
        // 単価表の「見出し」（spec === '__header__'）は 中項目（is_sub_category_header）として追加
        if (up.spec === '__header__') {
          return {
            ...emptySubCategoryItem(cat, up.name),
            unit_price_id: up.id,
          }
        }
        return calcItem({
          ...emptyItem(cat),
          name: up.name,
          spec: up.spec || '',
          unit: up.unit,
          quantity: '',
          unit_price: Number(up.price),
          purchase_quantity: '',
          purchase_unit_price: Number(up.buy_price || 0),
          unit_price_id: up.id,
        })
      })
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

  // 中項目（sub-category header）に紐づく明細の小計を計算
  // 同じカテゴリ内で、この中項目から次の中項目（または末尾/固定行）までの明細を集計
  function getSubCategorySubtotal(headerItem) {
    const startIdx = items.findIndex(i => i.id === headerItem.id)
    if (startIdx < 0) return { amount: 0, purchase: 0 }
    let amount = 0, purchase = 0
    for (let i = startIdx + 1; i < items.length; i++) {
      const it = items[i]
      // カテゴリが変わったら終了
      if (it.category !== headerItem.category) break
      // 次の中項目に到達したら終了
      if (it.is_sub_category_header) break
      // 雑材・管理費等の固定行はサブ小計に含めない
      if (it.is_misc_expense || it.is_managed_expense) continue
      amount += Number(it.amount || 0)
      purchase += Number(it.purchase_amount || 0)
    }
    return { amount, purchase }
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

  function makeNavKeyDown(col) {
    return e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      const inputs = [...document.querySelectorAll(`[data-nav-col="${col}"]`)]
      const idx = inputs.indexOf(e.currentTarget)
      if (idx === -1) return
      const next = inputs[idx + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) { next.focus(); next.select() }
    }
  }

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

  // 保存処理の多重実行ロック（React state は反映が非同期のため ref で即時に防御する）
  // ※ 過去に「申請する」連打により handleSave が3並行実行され、明細が3重に INSERT される事故が発生
  const saveLockRef = useRef(false)

  async function handleSave(status = 'draft', approverId = null, options = {}) {
    const { silent = false } = options
    // 多重実行防止：既に保存処理が走っていたら即 return
    if (saveLockRef.current) return
    saveLockRef.current = true
    try {
      await doSave(status, approverId, { silent })
    } finally {
      saveLockRef.current = false
    }
  }

  async function doSave(status = 'draft', approverId = null, options = {}) {
    const { silent = false } = options
    // 数量が空の明細チェック（silent モードはバックグラウンド保存なのでスキップ）
    if (!silent) {
      const emptyQtyItems = items.filter(i =>
        !i.is_misc_expense && !i.is_managed_expense && !i.is_sub_category_header &&
        (i.quantity === '' || i.quantity === null || i.quantity === undefined)
      )
      if (emptyQtyItems.length > 0) {
        const names = emptyQtyItems.map(i => i.name || '（品名未入力）').join('、')
        alert(`数量が入力されていない明細があります:\n${names}\n\n数量を入力してから保存してください。`)
        return
      }
    }
    if (!silent) setSaving(true)
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
        categories_json: JSON.stringify({
          list: categories,
          meta: categoryMeta,
          en_names: categoryEnNames,
          display_names: categoryDisplayNames,
          show_sub_subtotals: showSubSubtotals,
          show_english_labels: showEnglishLabels,
          item_labels: { welfare: welfareLabel, discount: discountLabel },
        }),
        ...(status === 'pending_approval' && approverId ? { requested_approver_id: approverId } : {}),
      }
      let quotationId = id

      if (isEdit) {
        // 更新時は created_by を変更しない（元の作成者を保持）
        await supabase.from('quotations').update(quotationData).eq('id', id)
        await supabase.from('quotation_items').delete().eq('quotation_id', id)
      } else {
        // 新規作成時のみ created_by を設定
        quotationData.created_by = profile.id
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        // 同日付の既存番号（base_number と quotation_number 両方）から最大の連番を取得して +1
        const [{ data: bnRows }, { data: qnRows }] = await Promise.all([
          supabase.from('quotations').select('base_number').like('base_number', `Q-${today}-%`),
          supabase.from('quotations').select('quotation_number').like('quotation_number', `Q-${today}-%`),
        ])
        const extractSeq = (s) => {
          if (!s) return 0
          const m = s.match(new RegExp(`^Q-${today}-(\\d+)`))
          return m ? parseInt(m[1], 10) : 0
        }
        const maxSeq = Math.max(
          0,
          ...(bnRows || []).map(r => extractSeq(r.base_number)),
          ...(qnRows || []).map(r => extractSeq(r.quotation_number)),
        )
        // 衝突しない番号を見つけるためのリトライループ（万一の競合に備える）
        let seqCandidate = maxSeq + 1
        let baseNumber = `Q-${today}-${String(seqCandidate).padStart(3, '0')}`
        let quotationNumber = `${baseNumber}-1`
        // 念のため重複チェック（最大10回まで）
        for (let i = 0; i < 10; i++) {
          const { data: dup } = await supabase
            .from('quotations')
            .select('id')
            .or(`base_number.eq.${baseNumber},quotation_number.eq.${quotationNumber}`)
            .limit(1)
          if (!dup || dup.length === 0) break
          seqCandidate++
          baseNumber = `Q-${today}-${String(seqCandidate).padStart(3, '0')}`
          quotationNumber = `${baseNumber}-1`
        }
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
        // 自動保存で作成された場合、内部IDを保持（URL遷移せずに以降は更新扱い）
        setCreatedId(quotationId)
      }

      const itemsToInsert = items
        .filter(i => i.is_misc_expense || i.is_managed_expense || i.is_sub_category_header || i.name.trim())
        .map((item, idx) => ({
          quotation_id: quotationId,
          sort_order: idx,
          name: item.name,
          spec: item.is_managed_expense
            ? `__managed__:${item.managed_expense_rate ?? 0}:${(item.base_cats || ['材料費', '労務費']).join(',')}:${item.managed_role || 'custom'}${item.managed_expense_manual ? ':M' : ''}`
            : item.is_misc_expense
              ? `__misc__:${item.misc_expense_rate ?? 10}${item.misc_expense_manual ? ':M' : ''}`
              : item.is_sub_category_header
                ? '__subcategory__'
                : (item.spec || null),
          description: isTextQty(item.quantity) ? `qty_text:${item.quantity}` : (item.description || null),
          category: item.category || '',
          quantity: isTextQty(item.quantity) ? 0 : (parseFloat(item.quantity) || 0),
          unit: item.unit,
          unit_price: item.is_misc_expense ? zaizaiAmount : item.is_managed_expense ? getManagedAmount(item) : Number(item.unit_price),
          amount: item.is_misc_expense ? zaizaiAmount : item.is_managed_expense ? getManagedAmount(item) : Number(item.amount),
          purchase_quantity: Number(item.purchase_quantity || 0),
          purchase_unit_price: Number(item.purchase_unit_price || 0),
          unit_price_id: item.unit_price_id || null,
        }))

      if (itemsToInsert.length > 0) {
        const { error: insertError } = await supabase.from('quotation_items').insert(itemsToInsert)
        if (insertError) {
          // unit_price_id カラムが未作成の場合はフォールバック（unit_price_id を除いて再試行）
          if (insertError.message?.includes('unit_price_id')) {
            const fallback = itemsToInsert.map(({ unit_price_id, ...rest }) => rest)
            await supabase.from('quotation_items').insert(fallback)
          }
        }
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

      // localStorage の一時保存はクリア（DBに下書きが残るため重複を防ぐ）
      localStorage.removeItem(`tenx_rfq_draft_new`)
      localStorage.removeItem(draftKey)
      setHasUnsavedChanges(false)
      if (silent) {
        // バックグラウンド保存：URL遷移せず、保存時刻のみ更新
        setAutoSavedAt(new Date())
      } else {
        setAutoSavedAt(null)
        navigate('/quotations')
      }
    } finally {
      if (!silent) setSaving(false)
    }
  }

  async function handleDuplicate(mode) {
    // 多重実行防止（保存と同じロックを共有 — 複製とsaveの並行実行も防ぐ）
    if (saveLockRef.current) return
    saveLockRef.current = true
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
      saveLockRef.current = false
    }
  }

  // 特権管理者は承認待ちの見積を直接編集できる（差し戻し→再申請のラリー削減）
  const canEditPending = isSuperAdmin && quotationStatus === 'pending_approval'
  const isReadOnly = isEdit && (
    quotationStatus === 'approved' ||
    (quotationStatus === 'pending_approval' && !canEditPending)
  )
  const checkedItems = items.filter(i => checkedItemIds.has(i.id))
  const checkedCategory = checkedItems.length > 0 ? checkedItems[0].category : null
  const canRegisterToUP = (isReadOnly || canEditPending) && checkedItems.length > 0
  const canApprove = quotationStatus === 'pending_approval' && (isApprover || profile?.id === requestedApproverId)
  // 申請取消: 承認待ち状態 かつ 自分が作成者
  const canCancelRequest = quotationStatus === 'pending_approval' && quotationCreatedBy && profile?.id === quotationCreatedBy

  async function handleCancelRequest() {
    if (!id) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('quotations')
        .update({ status: 'draft', requested_approver_id: null })
        .eq('id', id)
        .eq('status', 'pending_approval') // 競合防止
      if (error) throw error
      setQuotationStatus('draft')
      setRequestedApproverId(null)
      setCancelRequestModal(false)
    } catch (err) {
      alert('申請取消に失敗しました。\n' + err.message)
    } finally {
      setSaving(false)
    }
  }
  const customerOk = form.customer_id && (form.customer_id !== '__direct__' || form.customer_name.trim())
  const isFormValid = !!form.title && !!customerOk && !!form.company_id

  const STATUS_LABEL = {
    approved: { text: '承認済み', cls: 'bg-green-100 text-green-700' },
    pending_approval: { text: '承認待ち', cls: 'bg-yellow-100 text-yellow-700' },
    rejected: { text: '差し戻し', cls: 'bg-red-100 text-red-700' },
    draft: { text: '下書き', cls: 'bg-gray-100 text-gray-600' },
  }

  return (
    <div className="max-w-full px-2">
      {saveToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-600 text-white text-sm px-5 py-2.5 rounded-lg shadow-lg">
          ✓ {saveToast}
        </div>
      )}
      {canEditPending && (
        <div className="mb-3 px-4 py-2 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800">
          🛠️ 特権管理者として承認待ちの見積を直接編集できます。修正後「承認」すると修正内容が反映されます（差し戻し不要）。
        </div>
      )}
      <div className="grid grid-cols-3 items-center mb-6">
        {/* 左：タイトル＋ステータス */}
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
        {/* 中央：承認 / 差し戻しボタン */}
        <div className="flex items-center justify-center gap-3">
          {canApprove && (
            <>
              <button onClick={() => { setApprovalComment(''); setApprovalModal('reject') }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 font-medium shadow-sm">
                ↩ 差し戻し
              </button>
              <button onClick={() => { setApprovalComment(''); setApprovalModal('approve') }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 font-medium shadow-sm">
                ✓ 承認
              </button>
            </>
          )}
        </div>
        {/* 右：印刷・複製・戻るボタン */}
        <div className="flex items-center justify-end gap-2">
          {(isReadOnly || canEditPending) && (
            <>
              {canCancelRequest && (
                <button onClick={() => setCancelRequestModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-yellow-700 border border-yellow-400 rounded-lg hover:bg-yellow-50">
                  ↩ 申請取消
                </button>
              )}
              {canRegisterToUP && (
                <button onClick={handleOpenUPRegisterModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600">
                  📋 単価登録 ({checkedItems.length})
                </button>
              )}
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
              const isKyotsu = cat === '共通費'
              const kyotsuIdx = categories.indexOf('共通費')
              const catType = getCatType(cat)
              const TYPE_BADGE = { material: ['bg-orange-100 text-orange-700', '材料費系'], labor: ['bg-blue-100 text-blue-700', '労務費系'], overhead: ['bg-gray-100 text-gray-600', '共通費系'] }
              const isRenaming = renamingCatIdx === idx
              return (
                <div key={idx} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
                  {!isReadOnly && !isKyotsu && (
                    <>
                      <button onClick={() => moveCategory(idx, -1)} className="text-blue-400 hover:text-blue-700 disabled:opacity-30"
                        disabled={idx === 0}><ChevronUp size={13} /></button>
                      <button onClick={() => moveCategory(idx, 1)} className="text-blue-400 hover:text-blue-700 disabled:opacity-30"
                        disabled={kyotsuIdx !== -1 ? idx >= kyotsuIdx - 1 : idx === categories.length - 1}><ChevronDown size={13} /></button>
                    </>
                  )}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renamingCatValue}
                      onChange={e => setRenamingCatValue(e.target.value)}
                      onBlur={() => {
                        if (isDefaultCat) {
                          // 既定カテゴリは内部IDを保持し、表示名のみ上書き
                          const v = renamingCatValue.trim()
                          setCategoryDisplayNames(prev => {
                            const next = { ...prev }
                            if (!v || v === cat) delete next[cat]
                            else next[cat] = v
                            return next
                          })
                          setRenamingCatIdx(null)
                        } else {
                          renameCategory(idx, renamingCatValue)
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (isDefaultCat) {
                            const v = renamingCatValue.trim()
                            setCategoryDisplayNames(prev => {
                              const next = { ...prev }
                              if (!v || v === cat) delete next[cat]
                              else next[cat] = v
                              return next
                            })
                            setRenamingCatIdx(null)
                          } else {
                            renameCategory(idx, renamingCatValue)
                          }
                        }
                        if (e.key === 'Escape') setRenamingCatIdx(null)
                      }}
                      className="text-sm font-medium text-blue-800 border-b border-blue-400 bg-transparent focus:outline-none w-28 px-1"
                    />
                  ) : (
                    <span className="text-sm font-medium text-blue-800 px-1">■{categoryDisplayNames[cat] || cat}</span>
                  )}
                  {!isReadOnly && !isRenaming && (
                    <button onClick={() => { setRenamingCatIdx(idx); setRenamingCatValue(categoryDisplayNames[cat] || cat) }} className="text-blue-300 hover:text-blue-600" title="表示名を変更">
                      <Pencil size={11} />
                    </button>
                  )}
                  {isDefaultCat ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[catType][0]}`}>{TYPE_BADGE[catType][1]}</span>
                  ) : (
                    !isReadOnly && !isRenaming ? (
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
                  {!isReadOnly && !isRenaming && (
                    <input
                      value={cat in categoryEnNames ? categoryEnNames[cat] : (CAT_EN_DEFAULTS[cat] || '')}
                      onChange={e => setCategoryEnNames(prev => ({ ...prev, [cat]: e.target.value }))}
                      placeholder={isDefaultCat ? 'English (空で非表示)' : 'English name'}
                      className="text-xs border-b border-blue-300 bg-transparent focus:outline-none w-32 text-blue-600 placeholder-blue-200 px-1"
                    />
                  )}
                  {!isReadOnly && !isDefaultCat && (
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
                disabled={categories.length >= 10}
                className="flex items-center gap-1 text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-1.5 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus size={14} /> 追加 ({categories.length}/10)
              </button>
            </div>
          )}
        </div>

        {/* 明細 */}
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-700">明細</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-teal-700 cursor-pointer select-none">
                <input type="checkbox" checked={showSubSubtotals}
                  onChange={e => setShowSubSubtotals(e.target.checked)}
                  disabled={isReadOnly}
                  className="accent-teal-600 w-3.5 h-3.5" />
                中項目小計を表示
              </label>
              {!isReadOnly && (
                <button
                  onClick={() => { setShowCsvImportModal(true); setCsvImportStep('input'); setCsvImportError(''); }}
                  className="flex items-center gap-1.5 text-xs text-emerald-700 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-1.5 hover:bg-emerald-100"
                  title="Gemで生成した仕入CSVを貼り付けて一括取り込み"
                >
                  <Upload size={13} /> 仕入CSV取込
                </button>
              )}
            </div>
          </div>

          {/* モバイル用カードレイアウト (md未満) */}
          <div className="md:hidden space-y-2">
            {[...categories, ...(items.some(i => !i.category || !categories.includes(i.category)) ? ['__others__'] : [])].map(cat => {
              const isOther = cat === '__others__'
              const catJp = isOther ? '未分類' : (categoryDisplayNames[cat] || cat)
              const catEn = !isOther ? (cat in categoryEnNames ? categoryEnNames[cat] : (CAT_EN_DEFAULTS[cat] || '')) : ''
              const catLabel = catEn ? `${catEn} / ${catJp}` : catJp
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
              const catPurchaseSubtotal = catItems.reduce((s, { item }) => s + Number(item.purchase_amount || 0), 0)
              const catProfitRate = catSubtotal > 0 ? Math.round(((catSubtotal - catPurchaseSubtotal) / catSubtotal) * 100 * 10) / 10 : 0
              const inputCls = 'border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white'
              const firstSubHeaderId = catItems.find(({ item }) => item.is_sub_category_header)?.item.id
              return (
                <div key={cat} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* カテゴリヘッダー */}
                  <div className="bg-blue-50 px-3 py-2 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-blue-800">■ {catLabel}</span>
                    {!isOther && getCatType(cat) === 'overhead' && (
                      <label className="flex items-center gap-1.5 text-xs text-indigo-700 cursor-pointer select-none">
                        <input type="checkbox" checked={showEnglishLabels}
                          onChange={e => setShowEnglishLabels(e.target.checked)}
                          disabled={isReadOnly}
                          className="accent-indigo-600 w-3.5 h-3.5" />
                        管理費を英語表記（単位LS）
                      </label>
                    )}
                  </div>

                  {/* アイテム一覧 */}
                  {catItems.length === 0 ? (
                    <div className="px-4 py-3 text-center text-gray-400 text-xs">行がありません</div>
                  ) : catItems.map(({ item, globalIdx }, posInGroup) => {
                    const purchase_amount = Number(item.purchase_quantity || 0) * Number(item.purchase_unit_price || 0)
                    const profit_rate = item.amount > 0
                      ? Math.round(((item.amount - purchase_amount) / item.amount) * 100 * 10) / 10
                      : 0

                    // 中項目ヘッダーカード
                    if (item.is_sub_category_header) {
                      const isDragging = dragItemId === item.id
                      const isOver    = dragItemOverId === item.id && dragItemId !== item.id
                      const isFirstSub = item.id === firstSubHeaderId
                      return (
                        <div key={item.id}
                          draggable={!isReadOnly && !isFirstSub && dragHandleActiveId === item.id}
                          onDragStart={() => !isReadOnly && !isFirstSub && setDragItemId(item.id)}
                          onDragEnd={() => { setDragItemId(null); setDragItemOverId(null); setDragHandleActiveId(null) }}
                          onDragOver={e => { e.preventDefault(); !isReadOnly && !isFirstSub && setDragItemOverId(item.id) }}
                          onDrop={() => !isReadOnly && !isFirstSub && handleItemDrop(item)}
                          className={`bg-teal-50 border-t border-teal-200 px-3 py-2 flex items-center justify-between gap-2 ${isDragging ? 'opacity-40' : ''} ${isOver ? 'border-t-2 border-t-blue-500' : ''}`}>
                          <div className="flex items-center gap-2 flex-1">
                            {!isReadOnly && !isFirstSub && <span onMouseDown={() => setDragHandleActiveId(item.id)} onTouchStart={() => setDragHandleActiveId(item.id)}><GripVertical size={14} className="text-teal-400 shrink-0 cursor-grab active:cursor-grabbing" /></span>}
                            {!isReadOnly && isFirstSub && <span className="w-[14px] shrink-0 inline-block" />}
                            <span className="text-teal-500 font-bold text-sm">▸</span>
                            {!isReadOnly ? (
                              <input
                                value={item.name}
                                onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                className="flex-1 text-sm font-semibold text-teal-800 bg-transparent border-b border-teal-300 focus:outline-none focus:border-teal-500 placeholder-teal-300"
                                placeholder="中項目名を入力"
                              />
                            ) : (
                              <span className="text-sm font-semibold text-teal-800">{item.name || '（中項目）'}</span>
                            )}
                            <span className="text-xs text-teal-500 bg-teal-100 border border-teal-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">◀ {cat}</span>
                          </div>
                          {!isReadOnly && (
                            <button onClick={() => removeItem(globalIdx)} className="text-red-400 hover:text-red-600 shrink-0">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      )
                    }

                    // 雑材消耗品カード
                    if (item.is_misc_expense) {
                      const isRenamingThisMobM = renamingItemId === item.id
                      return (
                        <div key={item.id} className="bg-amber-50 border-t border-amber-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isRenamingThisMobM && !isReadOnly ? (
                                <input
                                  autoFocus
                                  value={item.name || ''}
                                  onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                  onBlur={() => setRenamingItemId(null)}
                                  onKeyDown={e => { if (e.key === 'Enter') setRenamingItemId(null); if (e.key === 'Escape') { updateItem(globalIdx, 'name', '雑材消耗品'); setRenamingItemId(null) } }}
                                  className="text-sm font-medium text-amber-800 bg-transparent border-b border-amber-400 focus:outline-none focus:border-amber-500 w-32 px-1"
                                />
                              ) : (
                                <span className="text-sm font-medium text-amber-800 flex items-center gap-1">
                                  {item.name || '雑材消耗品'}
                                  {!isReadOnly && (
                                    <button onClick={() => setRenamingItemId(item.id)} className="text-amber-400 hover:text-amber-700" title="名称を変更">
                                      <Pencil size={11} />
                                    </button>
                                  )}
                                </span>
                              )}
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
                      const isRenamingThisMobMng = renamingItemId === item.id
                      return (
                        <div key={item.id} className="bg-indigo-50 border-t border-indigo-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              {ROLE_TO_JP[item.managed_role] ? (
                                <span className="text-sm font-medium text-indigo-800">{managedDisplayName(item, showEnglishLabels)}</span>
                              ) : isRenamingThisMobMng && !isReadOnly ? (
                                <input
                                  autoFocus
                                  value={item.name || ''}
                                  onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                  onBlur={() => setRenamingItemId(null)}
                                  onKeyDown={e => { if (e.key === 'Enter') setRenamingItemId(null); if (e.key === 'Escape') setRenamingItemId(null) }}
                                  className="text-sm font-medium text-indigo-800 bg-transparent border-b border-indigo-400 focus:outline-none focus:border-indigo-500 w-32 px-1"
                                />
                              ) : (
                                <span className="text-sm font-medium text-indigo-800 flex items-center gap-1">
                                  {item.name}
                                  {!isReadOnly && (
                                    <button onClick={() => setRenamingItemId(item.id)} className="text-indigo-400 hover:text-indigo-700" title="名称を変更">
                                      <Pencil size={11} />
                                    </button>
                                  )}
                                </span>
                              )}
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
                    const isDragging = dragItemId === item.id
                    const isOver    = dragItemOverId === item.id && dragItemId !== item.id
                    // 中項目小計（モバイル）：直近の中項目ヘッダー、グローバル表示フラグ、セクション末尾判定
                    let subHeaderAboveM = null
                    for (let p = posInGroup - 1; p >= 0; p--) {
                      const it = catItems[p].item
                      if (it.is_sub_category_header) { subHeaderAboveM = it; break }
                    }
                    let isLastInSubSectionM = false
                    if (subHeaderAboveM && showSubSubtotals) {
                      let nextReg = false
                      for (let p = posInGroup + 1; p < catItems.length; p++) {
                        const nx = catItems[p].item
                        if (nx.is_sub_category_header) break
                        if (nx.is_misc_expense || nx.is_managed_expense) break
                        nextReg = true
                        break
                      }
                      isLastInSubSectionM = !nextReg
                    }
                    const subSectionSubtotalM = isLastInSubSectionM ? getSubCategorySubtotal(subHeaderAboveM) : null
                    return (
                      <ReactFragment key={item.id}>
                      <div
                        draggable={!isReadOnly && dragHandleActiveId === item.id}
                        onDragStart={() => !isReadOnly && setDragItemId(item.id)}
                        onDragEnd={() => { setDragItemId(null); setDragItemOverId(null); setDragHandleActiveId(null) }}
                        onDragOver={e => { e.preventDefault(); !isReadOnly && setDragItemOverId(item.id) }}
                        onDrop={() => !isReadOnly && handleItemDrop(item)}
                        className={`border-t border-gray-100 px-3 py-2 ${posInGroup % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isDragging ? 'opacity-40' : ''} ${isOver ? 'border-t-2 border-t-blue-500' : ''}`}>
                        {/* 行1: 並び替え・品名・複製・削除 */}
                        <div className="flex items-center gap-2">
                          {!isReadOnly && (
                            <div className="shrink-0 cursor-grab active:cursor-grabbing"
                              onMouseDown={() => setDragHandleActiveId(item.id)}
                              onTouchStart={() => setDragHandleActiveId(item.id)}>
                              <GripVertical size={16} className="text-gray-400" />
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
                              type="text"
                              value={item.quantity}
                              onChange={e => updateItem(globalIdx, 'quantity', e.target.value)}
                              className={`${inputCls} w-14 text-right ${(item.quantity === '' || item.quantity === null || item.quantity === undefined) ? 'bg-red-50 border-red-400 ring-1 ring-red-400' : ''}`}
                            />
                          ) : (
                            <span className="text-sm w-14 text-right">{item.quantity}</span>
                          )}
                          {!isReadOnly ? (
                            <input
                              value={item.unit}
                              onChange={e => updateItem(globalIdx, 'unit', e.target.value)}
                              disabled={isTextQty(item.quantity)}
                              className={`${inputCls} w-12 text-center ${isTextQty(item.quantity) ? 'opacity-40 cursor-not-allowed bg-gray-50' : ''}`}
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
                              disabled={isTextQty(item.quantity)}
                              className={`${inputCls} flex-1 text-right ${isTextQty(item.quantity) ? 'opacity-40 cursor-not-allowed bg-gray-50' : ''}`}
                            />
                          ) : (
                            <span className="text-sm flex-1 text-right">¥{fmt(item.unit_price)}</span>
                          )}
                        </div>
                        {/* 行4: 見積金額 */}
                        <div className="mt-0.5 ml-7 text-right">
                          <span className="font-medium text-gray-700 text-sm">
                            {isTextQty(item.quantity) ? '−' : `¥${fmt(item.amount)}`}
                          </span>
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
                      {isLastInSubSectionM && subSectionSubtotalM && (
                        <div className="bg-teal-50 border-t border-teal-200 px-3 py-1.5 flex justify-end items-center gap-3 flex-wrap">
                          <span className="text-xs text-teal-700 font-medium">▸ {subHeaderAboveM?.name || '中項目'}　小計</span>
                          <span className="text-sm font-bold text-teal-800">¥{fmt(subSectionSubtotalM.amount)}</span>
                          <span className="text-xs text-gray-400">仕入小計 ¥{fmt(subSectionSubtotalM.purchase)}</span>
                        </div>
                      )}
                      </ReactFragment>
                    )
                  })}

                  {/* 行追加ボタン */}
                  {!isOther && !isReadOnly && (
                    <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 flex items-center gap-4 flex-wrap">
                      <button onClick={() => addSubCategoryItem(cat)}
                        className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700">
                        <Plus size={12} /> 中項目を追加
                      </button>
                      {unitPriceTables.length > 0 && (
                        <button onClick={() => openUnitPriceModal(cat)}
                          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700">
                          <List size={12} /> 単価表から追加
                        </button>
                      )}
                      <button onClick={() => addItem(cat)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        <Plus size={12} /> 行を追加
                      </button>
                    </div>
                  )}

                  {/* 小計 */}
                  <div className="bg-blue-50 border-t border-blue-200 px-3 py-1.5 flex justify-end items-center gap-3 flex-wrap">
                    <span className="text-xs text-blue-600 font-medium">■ {catLabel}　小計</span>
                    <span className="text-sm font-bold text-blue-700">¥{fmt(catSubtotal)}</span>
                    <span className={`text-xs font-medium ${catProfitRate >= 0 ? 'text-green-600' : 'text-red-500'}`}>{`(${Number(catProfitRate).toFixed(1)}%)`}</span>
                    <span className="text-xs text-gray-400">■仕入　小計 ¥{fmt(catPurchaseSubtotal)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* デスクトップ用テーブルレイアウト (md以上) */}
          <div className="hidden md:block overflow-x-auto">
            <div className="relative" style={{ minWidth: '1200px' }}>
            <table className={`w-full text-sm border-collapse ${isReadOnly ? 'pointer-events-none select-none' : ''}`}>
              <thead>
                <tr className="bg-blue-700 text-white">
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left text-xs w-36">品名</th>
                  <th className="px-3 py-2 text-left text-xs w-72">仕様</th>
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
                const catJp = isOther ? '未分類' : (categoryDisplayNames[cat] || cat)
                const catEn = !isOther ? (cat in categoryEnNames ? categoryEnNames[cat] : (CAT_EN_DEFAULTS[cat] || '')) : ''
                const catLabel = catEn ? `${catEn} / ${catJp}` : catJp
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
                const catPurchaseSubtotal = catItems.reduce((s, { item }) => s + Number(item.purchase_amount || 0), 0)
                const catProfitRate = catSubtotal > 0 ? Math.round(((catSubtotal - catPurchaseSubtotal) / catSubtotal) * 100 * 10) / 10 : 0
                const firstSubHeaderId = catItems.find(({ item }) => item.is_sub_category_header)?.item.id
                return (
                  <tbody key={cat}>
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td colSpan={12} className="px-4 py-2">
                        <div className="flex items-center gap-4 flex-wrap">
                          <span className="text-sm font-semibold text-blue-800">■ {catLabel}</span>
                          {!isOther && getCatType(cat) === 'overhead' && (
                            <label className="flex items-center gap-1.5 text-xs text-indigo-700 cursor-pointer select-none">
                              <input type="checkbox" checked={showEnglishLabels}
                                onChange={e => setShowEnglishLabels(e.target.checked)}
                                disabled={isReadOnly}
                                className="accent-indigo-600 w-3.5 h-3.5" />
                              管理費を英語表記（単位LS）
                            </label>
                          )}
                        </div>
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

                      // 中項目ヘッダー行
                      if (item.is_sub_category_header) {
                        const isDragging = dragItemId === item.id
                        const isOver    = dragItemOverId === item.id && dragItemId !== item.id
                        const isFirstSub = item.id === firstSubHeaderId
                        return (
                          <tr key={item.id}
                            draggable={!isReadOnly && !isFirstSub && dragHandleActiveId === item.id}
                            onDragStart={() => !isReadOnly && !isFirstSub && setDragItemId(item.id)}
                            onDragEnd={() => { setDragItemId(null); setDragItemOverId(null); setDragHandleActiveId(null) }}
                            onDragOver={e => { e.preventDefault(); !isReadOnly && !isFirstSub && setDragItemOverId(item.id) }}
                            onDrop={() => !isReadOnly && !isFirstSub && handleItemDrop(item)}
                            className={`bg-teal-50 border-t-2 border-teal-200 ${isDragging ? 'opacity-40' : ''} ${isOver ? 'border-t-2 border-t-blue-500' : ''}`}>
                            <td className="border border-gray-200 px-1 py-1.5 text-center cursor-grab active:cursor-grabbing"
                              onMouseDown={() => !isFirstSub && setDragHandleActiveId(item.id)}
                              onTouchStart={() => !isFirstSub && setDragHandleActiveId(item.id)}>
                              {!isReadOnly && !isFirstSub && <GripVertical size={14} className="text-teal-400 mx-auto" />}
                            </td>
                            <td colSpan={10} className="border border-gray-200 px-3 py-1.5">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-teal-500 font-bold text-sm">▸</span>
                                {!isReadOnly ? (
                                  <input
                                    value={item.name}
                                    onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                    className="text-sm font-semibold text-teal-800 bg-transparent border-b border-teal-300 focus:outline-none focus:border-teal-500 w-56 placeholder-teal-300"
                                    placeholder="中項目名を入力"
                                  />
                                ) : (
                                  <span className="text-sm font-semibold text-teal-800">{item.name || '（中項目）'}</span>
                                )}
                                <span className="text-xs text-teal-500 bg-teal-100 border border-teal-200 px-2 py-0.5 rounded-full whitespace-nowrap">◀ {catLabel}</span>
                              </div>
                            </td>
                            <td className="border border-gray-200 px-1 py-1 text-center">
                              {!isReadOnly && (
                                <button onClick={() => removeItem(globalIdx)} className="text-red-400 hover:text-red-600">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      }

                      // 雑材消耗品の特別行
                      if (item.is_misc_expense) {
                        const isRenamingThis = renamingItemId === item.id
                        return (
                          <tr key={item.id} className="bg-amber-50 border border-amber-200">
                            <td className="border border-gray-200 px-1 py-1"></td>
                            <td colSpan={2} className="border border-gray-200 px-3 py-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isRenamingThis && !isReadOnly ? (
                                  <input
                                    autoFocus
                                    value={item.name || ''}
                                    onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                    onBlur={() => setRenamingItemId(null)}
                                    onKeyDown={e => { if (e.key === 'Enter') setRenamingItemId(null); if (e.key === 'Escape') { updateItem(globalIdx, 'name', '雑材消耗品'); setRenamingItemId(null) } }}
                                    className="text-sm font-medium text-amber-800 bg-transparent border-b border-amber-400 focus:outline-none focus:border-amber-500 w-32 px-1"
                                  />
                                ) : (
                                  <span className="text-sm font-medium text-amber-800 flex items-center gap-1">
                                    {item.name || '雑材消耗品'}
                                    {!isReadOnly && (
                                      <button onClick={() => setRenamingItemId(item.id)} className="text-amber-400 hover:text-amber-700" title="名称を変更">
                                        <Pencil size={11} />
                                      </button>
                                    )}
                                  </span>
                                )}
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
                        const isRenamingThisM = renamingItemId === item.id
                        return (
                          <tr key={item.id} className="bg-indigo-50 border border-indigo-200">
                            <td className="border border-gray-200 px-1 py-1"></td>
                            <td colSpan={2} className="border border-gray-200 px-3 py-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {ROLE_TO_JP[item.managed_role] ? (
                                  <span className="text-sm font-medium text-indigo-800">{managedDisplayName(item, showEnglishLabels)}</span>
                                ) : isRenamingThisM && !isReadOnly ? (
                                  <input
                                    autoFocus
                                    value={item.name || ''}
                                    onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                    onBlur={() => setRenamingItemId(null)}
                                    onKeyDown={e => { if (e.key === 'Enter') setRenamingItemId(null); if (e.key === 'Escape') setRenamingItemId(null) }}
                                    className="text-sm font-medium text-indigo-800 bg-transparent border-b border-indigo-400 focus:outline-none focus:border-indigo-500 w-32 px-1"
                                  />
                                ) : (
                                  <span className="text-sm font-medium text-indigo-800 flex items-center gap-1">
                                    {item.name}
                                    {!isReadOnly && (
                                      <button onClick={() => setRenamingItemId(item.id)} className="text-indigo-400 hover:text-indigo-700" title="名称を変更">
                                        <Pencil size={11} />
                                      </button>
                                    )}
                                  </span>
                                )}
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

                      // 通常明細行
                      const isDragging = dragItemId === item.id
                      const isOver = dragItemOverId === item.id && dragItemId !== item.id
                      // 中項目小計：直近の中項目ヘッダーを遡って探し、グローバル表示フラグが ON で、
                      // かつ次が中項目ヘッダーか固定行(雑材/管理費)か末尾なら本行の後ろに小計を出す
                      let subHeaderAbove = null
                      for (let p = posInGroup - 1; p >= 0; p--) {
                        const it = catItems[p].item
                        if (it.is_sub_category_header) { subHeaderAbove = it; break }
                      }
                      let isLastInSubSection = false
                      if (subHeaderAbove && showSubSubtotals) {
                        let nextRegular = false
                        for (let p = posInGroup + 1; p < catItems.length; p++) {
                          const nx = catItems[p].item
                          if (nx.is_sub_category_header) break
                          if (nx.is_misc_expense || nx.is_managed_expense) break
                          nextRegular = true
                          break
                        }
                        isLastInSubSection = !nextRegular
                      }
                      const subSectionSubtotal = isLastInSubSection ? getSubCategorySubtotal(subHeaderAbove) : null
                      return (
                        <ReactFragment key={item.id}>
                        <tr
                            draggable={!isReadOnly && dragHandleActiveId === item.id}
                            onDragStart={() => !isReadOnly && setDragItemId(item.id)}
                            onDragEnd={() => { setDragItemId(null); setDragItemOverId(null); setDragHandleActiveId(null) }}
                            onDragOver={e => { e.preventDefault(); !isReadOnly && setDragItemOverId(item.id) }}
                            onDrop={() => !isReadOnly && handleItemDrop(item)}
                            className={`${posInGroup % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'} ${isDragging ? 'opacity-40' : ''} ${isOver ? 'border-t-2 border-t-blue-500' : ''}`}>
                            <td className="border border-gray-200 px-1 py-1 pointer-events-auto">
                              {isReadOnly && item.name.trim() ? (
                                <input type="checkbox" checked={checkedItemIds.has(item.id)} onChange={() => toggleItemCheck(item)}
                                  disabled={checkedCategory !== null && item.category !== checkedCategory}
                                  className="w-4 h-4 accent-blue-600 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" />
                              ) : !isReadOnly && (
                                <div className="cursor-grab active:cursor-grabbing flex items-center justify-center"
                                  onMouseDown={() => setDragHandleActiveId(item.id)}
                                  onTouchStart={() => setDragHandleActiveId(item.id)}>
                                  <GripVertical size={14} className="text-gray-400" />
                                </div>
                              )}
                            </td>
                            <td className="border border-gray-200 px-2 py-1">
                              <div className="flex gap-1 items-center">
                                <input value={item.name} onChange={e => updateItem(globalIdx, 'name', e.target.value)}
                                  className="flex-1 min-w-0 border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" placeholder="品名" />
                              </div>
                            </td>
                            <td className="border border-gray-200 px-1 py-1">
                              <input value={item.spec || ''} onChange={e => updateItem(globalIdx, 'spec', e.target.value)}
                                className="w-full border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-xs text-gray-500" placeholder="型番・仕様" />
                            </td>
                            <td className="border border-gray-200 px-1 py-1">
                              <input type="text" value={item.quantity} onChange={e => updateItem(globalIdx, 'quantity', e.target.value)}
                                data-nav-col="quantity" onKeyDown={makeNavKeyDown('quantity')}
                                className={`w-full text-right border-0 focus:outline-none focus:ring-1 rounded px-1 py-0.5 text-sm ${(item.quantity === '' || item.quantity === null || item.quantity === undefined) ? 'bg-red-50 focus:ring-red-400 text-red-600' : 'bg-transparent focus:ring-blue-300'}`} />
                            </td>
                            <td className="border border-gray-200 px-1 py-1">
                              <input value={item.unit} onChange={e => updateItem(globalIdx, 'unit', e.target.value)}
                                disabled={isTextQty(item.quantity)}
                                className={`w-full text-center border-0 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm ${isTextQty(item.quantity) ? 'opacity-40 cursor-not-allowed bg-gray-100' : 'bg-transparent'}`} />
                            </td>
                            <td className="border border-gray-200 px-1 py-1">
                              <input type="text" inputMode="numeric" value={fmt(item.unit_price)} onFocus={e => e.target.select()}
                                onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) updateItem(globalIdx, 'unit_price', raw) }}
                                disabled={isTextQty(item.quantity)}
                                data-nav-col="unit_price" onKeyDown={makeNavKeyDown('unit_price')}
                                className={`w-full text-right border-0 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm ${isTextQty(item.quantity) ? 'opacity-40 cursor-not-allowed bg-gray-100' : 'bg-transparent'}`} />
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-right text-sm font-medium text-gray-700">
                              {isTextQty(item.quantity) ? '−' : `¥${fmt(item.amount)}`}
                            </td>
                            <td className="border border-gray-200 border-l-2 border-l-blue-200 px-1 py-1">
                              <input type="number" value={item.purchase_quantity || 0} onChange={e => updateItem(globalIdx, 'purchase_quantity', e.target.value)}
                                data-nav-col="purchase_quantity" onKeyDown={makeNavKeyDown('purchase_quantity')}
                                className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" min="0" />
                            </td>
                            <td className="border border-gray-200 px-1 py-1">
                              <input type="text" inputMode="numeric" value={fmt(item.purchase_unit_price || 0)} onFocus={e => e.target.select()}
                                onChange={e => { const raw = Number(e.target.value.replace(/,/g, '')); if (!isNaN(raw)) updateItem(globalIdx, 'purchase_unit_price', raw) }}
                                data-nav-col="purchase_unit_price" onKeyDown={makeNavKeyDown('purchase_unit_price')}
                                className="w-full text-right border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-sm" />
                            </td>
                            <td className="border border-gray-200 px-2 py-1 text-right text-sm text-gray-600">¥{fmt(purchase_amount)}</td>
                            <td className={`border border-gray-200 px-2 py-1 text-right text-sm font-medium ${profit_rate >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtRate(profit_rate)}</td>
                            <td className="border border-gray-200 px-1 py-1">
                              {!isReadOnly && (
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => duplicateItem(globalIdx)} title="複製" className="text-blue-400 hover:text-blue-600"><Copy size={13} /></button>
                                  <button onClick={() => removeItem(globalIdx)} title="削除" className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {isLastInSubSection && subSectionSubtotal && (
                            <tr className="bg-teal-50 border-t border-teal-200">
                              <td colSpan={5}></td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                <span className="text-xs text-teal-700 font-medium">▸ {subHeaderAbove?.name || '中項目'}　小計</span>
                              </td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                <span className="text-sm font-bold text-teal-800">¥{fmt(subSectionSubtotal.amount)}</span>
                              </td>
                              <td colSpan={2}></td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                <span className="text-xs text-gray-400">仕入小計 ¥{fmt(subSectionSubtotal.purchase)}</span>
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                          )}
                        </ReactFragment>
                      )
                    })}
                    {!isOther && !isReadOnly && (
                      <tr>
                        <td colSpan={12} className="px-3 py-1.5 bg-gray-50 border-gray-200">
                          <div className="flex items-center gap-4 flex-wrap">
                            <button onClick={() => addSubCategoryItem(cat)}
                              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700">
                              <Plus size={12} /> 中項目を追加
                            </button>
                            {unitPriceTables.length > 0 && (
                              <button onClick={() => openUnitPriceModal(cat)}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700">
                                <List size={12} /> 単価表から追加
                              </button>
                            )}
                            <button onClick={() => addItem(cat)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                              <Plus size={12} /> 行を追加
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className="bg-blue-50 border-t border-blue-200">
                      <td colSpan={5} className="py-1.5"></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="text-xs text-blue-600 font-medium">■ {catLabel}　小計</span>
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="text-sm font-bold text-blue-700">¥{fmt(catSubtotal)}</span>
                      </td>
                      <td colSpan={2} className="py-1.5"></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="text-xs text-gray-400">■仕入　小計 ¥{fmt(catPurchaseSubtotal)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className={`text-xs font-medium ${catProfitRate >= 0 ? 'text-green-600' : 'text-red-500'}`}>{`(${Number(catProfitRate).toFixed(1)}%)`}</span>
                      </td>
                      <td className="py-1.5"></td>
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
                <span className="text-gray-500 whitespace-nowrap flex items-center gap-1">
                  {renamingWelfare && !isReadOnly ? (
                    <input
                      autoFocus
                      value={welfareLabel}
                      onChange={e => setWelfareLabel(e.target.value)}
                      onBlur={() => setRenamingWelfare(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setRenamingWelfare(false); if (e.key === 'Escape') { setWelfareLabel(SPECIAL_LABELS_DEFAULTS.welfare); setRenamingWelfare(false) } }}
                      className="text-sm bg-transparent border-b border-gray-400 focus:outline-none w-32 px-1"
                    />
                  ) : (
                    <>
                      {welfareLabel || SPECIAL_LABELS_DEFAULTS.welfare}
                      {!isReadOnly && (
                        <button onClick={() => setRenamingWelfare(true)} className="text-gray-300 hover:text-gray-600 ml-1" title="名称を変更">
                          <Pencil size={11} />
                        </button>
                      )}
                    </>
                  )}
                </span>
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
                <span className="text-gray-500 flex items-center gap-1">
                  {renamingDiscount && !isReadOnly ? (
                    <input
                      autoFocus
                      value={discountLabel}
                      onChange={e => setDiscountLabel(e.target.value)}
                      onBlur={() => setRenamingDiscount(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setRenamingDiscount(false); if (e.key === 'Escape') { setDiscountLabel(SPECIAL_LABELS_DEFAULTS.discount); setRenamingDiscount(false) } }}
                      className="text-sm bg-transparent border-b border-gray-400 focus:outline-none w-32 px-1"
                    />
                  ) : (
                    <>
                      {discountLabel || SPECIAL_LABELS_DEFAULTS.discount}
                      {!isReadOnly && (
                        <button onClick={() => setRenamingDiscount(true)} className="text-gray-300 hover:text-gray-600 ml-1" title="名称を変更">
                          <Pencil size={11} />
                        </button>
                      )}
                    </>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  {!isReadOnly && (
                    <>
                      <input type="number" value={form.discount_rate} min="0" max="100" step="0.1"
                        onChange={e => setForm(f => ({ ...f, discount_rate: e.target.value, discount_manual: false }))}
                        className="w-10 text-center border border-gray-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <span className="text-xs text-gray-400">% 小計×</span>
                      {form.discount_manual && (
                        <button onClick={() => { clearTimeout(discountTimerRef.current); setDiscountDraft(null); setForm(f => ({ ...f, discount_manual: false })) }}
                          className="text-xs text-blue-600 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-gray-50">更新</button>
                      )}
                      {form.discount_manual && (
                        <span className="text-xs text-orange-600 border border-orange-300 rounded px-1 py-0.5">手動</span>
                      )}
                    </>
                  )}
                  <span className="text-gray-400 ml-1">-¥</span>
                  <input type="text" inputMode="numeric"
                    value={discountDraft !== null ? discountDraft : fmt(form.discount_manual ? form.discount : autoDiscount)}
                    readOnly={isReadOnly}
                    onFocus={e => e.target.select()}
                    onChange={e => {
                      const raw = e.target.value.replace(/,/g, '')
                      setDiscountDraft(raw)
                      clearTimeout(discountTimerRef.current)
                      discountTimerRef.current = setTimeout(() => {
                        const num = Number(raw)
                        if (!isNaN(num)) setForm(f => ({ ...f, discount: num, discount_manual: true }))
                        setDiscountDraft(null)
                      }, 3000)
                    }}
                    onBlur={() => {
                      if (discountDraft !== null) {
                        clearTimeout(discountTimerRef.current)
                        const num = Number(discountDraft)
                        if (!isNaN(num)) setForm(f => ({ ...f, discount: num, discount_manual: true }))
                        setDiscountDraft(null)
                      }
                    }}
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
        <div className="grid grid-cols-3 items-center">
          {/* 左：戻る / キャンセル */}
          <div className="flex">
            <button onClick={() => navigate('/quotations')}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              {isReadOnly ? '一覧に戻る' : 'キャンセル'}
            </button>
          </div>
          {/* 中央：承認 / 差し戻しボタン */}
          <div className="flex justify-center gap-3">
            {canApprove && (
              <>
                <button onClick={() => { setApprovalComment(''); setApprovalModal('reject') }}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 font-medium shadow-sm">
                  ↩ 差し戻し
                </button>
                <button onClick={() => { setApprovalComment(''); setApprovalModal('approve') }}
                  className="flex items-center gap-1.5 px-5 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 font-medium shadow-sm">
                  ✓ 承認
                </button>
              </>
            )}
          </div>
          {/* 右：印刷・複製・保存・承認申請 */}
          <div className="flex items-center justify-end gap-3">
          {!isReadOnly && autoSavedAt && (
            <span className="text-xs text-gray-400 whitespace-nowrap">
              🕐 自動保存済み {autoSavedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {isReadOnly && (
            <>
              {canCancelRequest && (
                <button onClick={() => setCancelRequestModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-yellow-700 border border-yellow-400 rounded-lg hover:bg-yellow-50">
                  ↩ 申請取消
                </button>
              )}
              {canRegisterToUP && (
                <button onClick={handleOpenUPRegisterModal}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600">
                  📋 単価登録 ({checkedItems.length})
                </button>
              )}
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
          {!isReadOnly && !canEditPending && (
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
          {canEditPending && (
            <button
              onClick={async () => {
                await handleSave('pending_approval', requestedApproverId, { silent: true })
                setSaveToast('修正を保存しました（承認待ちのまま）')
                setTimeout(() => setSaveToast(''), 2500)
              }}
              disabled={saving || !isFormValid}
              className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {saving ? '保存中...' : '修正を保存'}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* 下書き復元モーダル */}
      {showRestoreModal && pendingRestore && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl bg-amber-100 text-amber-600">
              💾
            </div>
            <h3 className="text-lg font-bold text-center mb-1 text-gray-800">自動保存された下書きがあります</h3>
            <p className="text-sm text-gray-500 text-center mb-2">
              保存日時: {new Date(pendingRestore.savedAt).toLocaleString('ja-JP')}
            </p>
            <p className="text-sm text-gray-600 text-center mb-6">復元しますか？</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  localStorage.removeItem(draftKey)
                  setShowRestoreModal(false)
                  setPendingRestore(null)
                }}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                破棄する
              </button>
              <button
                onClick={handleRestore}
                className="flex-1 px-4 py-2.5 text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600 font-medium">
                復元する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 承認 / 差し戻し 確認モーダル */}
      {approvalModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold ${approvalModal === 'approve' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
              {approvalModal === 'approve' ? '✓' : '↩'}
            </div>
            <h3 className={`text-lg font-bold text-center mb-1 ${approvalModal === 'approve' ? 'text-green-700' : 'text-red-600'}`}>
              {approvalModal === 'approve' ? 'この見積を承認しますか？' : 'この見積を差し戻しますか？'}
            </h3>
            <p className="text-xs text-gray-400 text-center mb-4">
              {approvalModal === 'approve' ? '承認すると申請者に通知されます。' : '差し戻しすると申請者に通知されます。'}
            </p>
            <textarea
              value={approvalComment}
              onChange={e => setApprovalComment(e.target.value)}
              placeholder="コメント（任意）"
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 resize-none mb-4 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="flex gap-3">
              <button onClick={() => setApprovalModal(null)}
                className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                キャンセル
              </button>
              <button
                onClick={() => handleDirectApproval(approvalModal)}
                disabled={approvalProcessing}
                className={`flex-1 px-4 py-2.5 text-sm text-white rounded-lg disabled:opacity-50 font-medium ${approvalModal === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}>
                {approvalProcessing ? '処理中...' : approvalModal === 'approve' ? '承認する' : '差し戻す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 申請取消確認モーダル */}
      {cancelRequestModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-yellow-100">
                <span className="text-xl">↩</span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 text-base">承認申請を取り消しますか？</h3>
                <p className="text-xs text-gray-500 mt-1">下書き状態に戻り、内容を編集できるようになります。</p>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-5 text-sm text-yellow-800">
              承認者への通知は自動では送信されません。必要に応じて直接ご連絡ください。
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setCancelRequestModal(false)} disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
                いいえ
              </button>
              <button onClick={handleCancelRequest} disabled={saving}
                className="px-4 py-2 text-sm text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 disabled:opacity-50">
                {saving ? '処理中...' : 'はい、取り消す'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* 単価表登録モーダル */}
      {showUPRegisterModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-800">
                {upRegisterStep === 'selectTable' ? '単価表に登録' : '重複確認'}
              </h3>
              <button onClick={() => setShowUPRegisterModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="overflow-y-auto p-4">
              {upRegisterStep === 'selectTable' && (
                <>
                  <p className="text-sm text-gray-600 mb-3">
                    選択中の{checkedItems.length}件（{checkedCategory}）をどの単価表に登録しますか？
                  </p>
                  <div className="space-y-2">
                    {unitPriceTables.map(t => (
                      <label key={t.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${upRegisterTableId === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                        <input type="radio" name="upTable" value={t.id} checked={upRegisterTableId === t.id} onChange={() => setUpRegisterTableId(t.id)} className="accent-blue-600" />
                        <span className="text-sm text-gray-800">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
              {upRegisterStep === 'confirmDuplicates' && (
                <>
                  <p className="text-sm text-gray-600 mb-3">以下の品目は既に登録されています。各品目の処理方法を選択してください。</p>
                  <div className="space-y-3">
                    {upRegisterDuplicates.map(({ item, existing }) => (
                      <div key={item.id} className="border border-gray-200 rounded-lg p-3">
                        <div className="text-sm font-medium text-gray-800 mb-1">{item.name}</div>
                        {item.spec && <div className="text-xs text-gray-500 mb-2">仕様: {item.spec}</div>}
                        <div className="text-xs mb-2 space-y-0.5">
                          {(() => {
                            const priceChanged = Number(item.unit_price) !== Number(existing.price)
                            const buyChanged = Number(item.purchase_unit_price || 0) !== Number(existing.buy_price || 0)
                            return (<>
                              <div className={priceChanged ? 'text-red-500 font-medium' : 'text-gray-400'}>
                                見積単価: ¥{Number(existing.price).toLocaleString()} → <span className={priceChanged ? 'text-red-600 font-bold' : ''}>¥{Number(item.unit_price).toLocaleString()}</span>
                                {priceChanged && ' ⚠'}
                              </div>
                              <div className={buyChanged ? 'text-red-500 font-medium' : 'text-gray-400'}>
                                仕入単価: ¥{Number(existing.buy_price || 0).toLocaleString()} → <span className={buyChanged ? 'text-red-600 font-bold' : ''}>¥{Number(item.purchase_unit_price || 0).toLocaleString()}</span>
                                {buyChanged && ' ⚠'}
                              </div>
                            </>)
                          })()}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setUpRegisterDecisions(prev => ({ ...prev, [item.id]: 'overwrite' }))}
                            className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${upRegisterDecisions[item.id] === 'overwrite' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-orange-100'}`}>
                            上書き
                          </button>
                          <button
                            onClick={() => setUpRegisterDecisions(prev => ({ ...prev, [item.id]: 'new' }))}
                            className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${upRegisterDecisions[item.id] === 'new' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-blue-100'}`}>
                            新規作成
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3 justify-end p-4 border-t">
              <button onClick={() => setShowUPRegisterModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
              {upRegisterStep === 'selectTable' && (
                <button onClick={handleUPRegisterConfirm} disabled={!upRegisterTableId || upRegisterSaving} className="px-4 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50">
                  {upRegisterSaving ? '確認中...' : '確認'}
                </button>
              )}
              {upRegisterStep === 'confirmDuplicates' && (
                <button
                  onClick={() => doUPRegister(upRegisterDecisions)}
                  disabled={upRegisterSaving || upRegisterDuplicates.some(({ item }) => !upRegisterDecisions[item.id])}
                  className="px-4 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50">
                  {upRegisterSaving ? '登録中...' : '登録実行'}
                </button>
              )}
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
      {/* ===== 仕入CSV取り込みモーダル ===== */}
      {showCsvImportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-800 text-sm">
                {csvImportStep === 'input' ? '仕入CSVを貼り付けて取り込み' : `取込内容を確認 (${csvImportRows.filter(r => r.include).length} / ${csvImportRows.length} 件)`}
              </h3>
              <button onClick={() => setShowCsvImportModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {/* Step 1: 入力 */}
            {csvImportStep === 'input' && (
              <div className="p-5 overflow-y-auto flex-1">
                <p className="text-xs text-gray-500 mb-2">
                  Gem「10X RFQ専用」で生成されたCSVをここに貼り付けてください。
                  ヘッダー：<code className="bg-gray-100 px-1 rounded">カテゴリ,品名,仕様,数量,単位,仕入数量,仕入単価</code>
                </p>
                <textarea
                  value={csvImportText}
                  onChange={e => setCsvImportText(e.target.value)}
                  placeholder={`カテゴリ,品名,仕様,数量,単位,仕入数量,仕入単価\n材料費,主装置,ET-XIS-ME,1,台,1,231000\n労務費,設置工事,,1,式,1,20000\n共通費,運搬・交通費,,1,式,1,20000`}
                  className="w-full h-64 border border-gray-300 rounded-lg p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {csvImportError && <p className="mt-2 text-xs text-red-500">{csvImportError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setShowCsvImportModal(false)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
                  <button onClick={handleParseCsv} disabled={!csvImportText.trim()}
                    className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-40">
                    解析してプレビュー →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: プレビュー */}
            {csvImportStep === 'preview' && (
              <>
                <div className="px-5 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-3 flex-wrap text-xs">
                  <span className="text-gray-600">一括変更:</span>
                  {categories.map(c => (
                    <button key={c} onClick={() => setAllCsvCategory(c)}
                      className="px-2.5 py-1 border border-gray-300 rounded-md bg-white hover:bg-blue-50 hover:border-blue-300">
                      → {categoryDisplayNames[c] || c}
                    </button>
                  ))}
                  <span className="text-gray-300">|</span>
                  <button onClick={() => setAllCsvInclude(true)} className="px-2.5 py-1 border border-gray-300 rounded-md bg-white hover:bg-gray-100">全選択</button>
                  <button onClick={() => setAllCsvInclude(false)} className="px-2.5 py-1 border border-gray-300 rounded-md bg-white hover:bg-gray-100">全解除</button>
                </div>

                <div className="overflow-y-auto flex-1 px-5 py-3">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-gray-500 border-b border-gray-200">
                        <th className="px-1 py-2 w-8 text-center">✓</th>
                        <th className="px-2 py-2 text-left w-28">カテゴリ</th>
                        <th className="px-2 py-2 text-left">品名</th>
                        <th className="px-2 py-2 text-left">仕様</th>
                        <th className="px-2 py-2 text-right w-14">数量</th>
                        <th className="px-2 py-2 text-left w-14">単位</th>
                        <th className="px-2 py-2 text-right w-20">仕入単価</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvImportRows.map((r, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${!r.include ? 'opacity-40' : ''}`}>
                          <td className="px-1 py-1.5 text-center">
                            <input type="checkbox" checked={r.include} onChange={e => updateCsvRow(i, 'include', e.target.checked)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={r.category} onChange={e => updateCsvRow(i, 'category', e.target.value)}
                              className={`w-full border rounded px-1.5 py-1 text-xs ${r.confidence === 'low' ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'}`}>
                              <option value="">—</option>
                              {categories.map(c => <option key={c} value={c}>{categoryDisplayNames[c] || c}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={r.name} onChange={e => updateCsvRow(i, 'name', e.target.value)}
                              className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={r.spec} onChange={e => updateCsvRow(i, 'spec', e.target.value)}
                              className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={r.quantity} onChange={e => updateCsvRow(i, 'quantity', e.target.value)}
                              className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-right" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={r.unit} onChange={e => updateCsvRow(i, 'unit', e.target.value)}
                              className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={r.purchase_unit_price} onChange={e => updateCsvRow(i, 'purchase_unit_price', e.target.value)}
                              className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-right" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs text-gray-500">
                    🟡 = 自動判別の信頼度低（要確認）／ 見積単価は取込後にご自身で設定してください
                  </div>
                  {csvImportError && <span className="text-xs text-red-500">{csvImportError}</span>}
                  <div className="flex gap-2">
                    <button onClick={() => setCsvImportStep('input')}
                      className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">← 戻る</button>
                    <button onClick={handleConfirmCsvImport}
                      className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                      この内容で取り込む
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showUnitPriceModal !== null && (() => {
        const cat = showUnitPriceModal
        const filteredTables = unitPriceTables
        const displayItems = upModalAllItems.filter(up => {
          if (up.spec === '__header__') return !upModalSearch
          return !upModalSearch || up.name.toLowerCase().includes(upModalSearch.toLowerCase()) || (up.spec || '').toLowerCase().includes(upModalSearch.toLowerCase())
        })
        const selectableItems = displayItems.filter(i => i.spec !== '__header__')
        const allChecked = selectableItems.length > 0 && selectableItems.every(i => upModalCheckedIds.has(i.id))
        // 複数テーブル選択時にテーブル名セパレーターを挿入
        const multiTable = upModalSelectedTableIds.size > 1
        const renderedItems = []
        if (multiTable && !upModalSearch) {
          let lastTableId = null
          displayItems.forEach(up => {
            if (up.table_id !== lastTableId) {
              renderedItems.push({ _isTableHeader: true, id: `th-${up.table_id}`, _tableName: up._tableName })
              lastTableId = up.table_id
            }
            renderedItems.push(up)
          })
        } else {
          renderedItems.push(...displayItems)
        }

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
                  {!upModalLoading && multiTable && !upModalSearch && (
                    <div className="px-3 py-2 border-b bg-blue-50 shrink-0 flex gap-1.5 flex-wrap items-center">
                      <span className="text-xs text-blue-600 shrink-0">単価表：</span>
                      {unitPriceTables.filter(t => upModalSelectedTableIds.has(t.id)).map(t => (
                        <button key={t.id}
                          onClick={() => {
                            const el = document.getElementById(`modal-table-${t.id}`)
                            if (!el || !upModalScrollRef.current) return
                            const containerTop = upModalScrollRef.current.getBoundingClientRect().top
                            const elTop = el.getBoundingClientRect().top
                            upModalScrollRef.current.scrollTo({
                              top: upModalScrollRef.current.scrollTop + (elTop - containerTop) - 8,
                              behavior: 'smooth'
                            })
                          }}
                          className="px-2 py-0.5 text-xs font-medium text-blue-800 bg-white border border-blue-300 rounded-full hover:bg-blue-100 transition-colors">
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {!upModalLoading && !upModalSearch && (() => {
                    const modalHeaders = displayItems.filter(i => i.spec === '__header__')
                    if (modalHeaders.length === 0) return null
                    return (
                      <div className="px-3 py-2 border-b bg-amber-50 shrink-0 flex gap-1.5 flex-wrap items-center">
                        <span className="text-xs text-amber-700 shrink-0">見出し：</span>
                        {modalHeaders.map(h => (
                          <button key={h.id}
                            onClick={() => {
                              const el = document.getElementById(`modal-header-${h.id}`)
                              if (!el || !upModalScrollRef.current) return
                              const containerTop = upModalScrollRef.current.getBoundingClientRect().top
                              const elTop = el.getBoundingClientRect().top
                              upModalScrollRef.current.scrollTo({
                                top: upModalScrollRef.current.scrollTop + (elTop - containerTop) - 8,
                                behavior: 'smooth'
                              })
                            }}
                            className="px-2 py-0.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-full hover:bg-amber-100 transition-colors flex items-center gap-1">
                            【{h.name}】
                            <span className="text-[10px] text-amber-500">{h.category}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  {!upModalLoading && selectableItems.length > 0 && (
                    <div className="px-4 py-1.5 border-b bg-gray-50 shrink-0">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={allChecked}
                          onChange={() => {
                            if (allChecked) {
                              setUpModalCheckedIds(prev => {
                                const next = new Set(prev)
                                selectableItems.forEach(i => next.delete(i.id))
                                return next
                              })
                            } else {
                              setUpModalCheckedIds(prev => {
                                const next = new Set(prev)
                                selectableItems.forEach(i => next.add(i.id))
                                return next
                              })
                            }
                          }}
                          className="w-4 h-4 accent-blue-600" />
                        <span className="text-xs text-gray-500">すべて選択</span>
                      </label>
                    </div>
                  )}
                  <div ref={upModalScrollRef} className="overflow-y-auto flex-1 p-2">
                    {upModalLoading ? (
                      <p className="text-center text-gray-400 py-10 text-sm">読み込み中...</p>
                    ) : selectableItems.length === 0 ? (
                      <p className="text-center text-gray-400 py-10 text-sm">該当なし</p>
                    ) : (
                      renderedItems.map(up => {
                        if (up._isTableHeader) {
                          return (
                            <div id={`modal-table-${up.table_id}`} key={up.id} className="px-3 py-1.5 mt-2 mb-0.5 text-xs font-bold text-white bg-blue-600 rounded flex items-center gap-1.5">
                              <span>📋</span>{up._tableName}
                            </div>
                          )
                        }
                        if (up.spec === '__header__') {
                          const checked = upModalCheckedIds.has(up.id)
                          return (
                            <label id={`modal-header-${up.id}`} key={up.id}
                              className={`flex items-center gap-3 px-3 py-2 mt-1 mb-0.5 rounded cursor-pointer hover:bg-amber-100 ${checked ? 'bg-amber-100 border border-amber-400' : 'bg-amber-50 border border-transparent'}`}>
                              <input type="checkbox" checked={checked}
                                onChange={() => toggleItemId(up.id)}
                                className="w-4 h-4 accent-amber-600 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-amber-800">【{up.name}】</p>
                                <p className="text-[10px] text-amber-600">中項目として追加</p>
                              </div>
                            </label>
                          )
                        }
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
