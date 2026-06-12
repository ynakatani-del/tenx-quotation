import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Printer, ArrowLeft, X } from 'lucide-react'
import html2canvas from 'html2canvas'

const FONT = "'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', serif"

function titleFontSize(title = '') {
  if (title.length > 50) return '8pt'
  if (title.length > 35) return '9pt'
  return '10pt'
}

function customerFontSize(name = '') {
  if (name.length > 20) return '10pt'
  if (name.length > 14) return '12pt'
  return '14pt'
}
function customerFontSizeJP(name = '') {
  if (name.length > 20) return '7pt'
  if (name.length > 14) return '9pt'
  return '11pt'
}

function itemFontSize(text = '') {
  if (text.length > 40) return '7pt'
  if (text.length > 28) return '8pt'
  return '8.5pt'
}

// カテゴリ順序に従ってアイテムをグループ化
function buildCatGroupsOrdered(items, categoriesOrder) {
  const groupMap = new Map()
  items.forEach(item => {
    const cat = item.category || ''
    if (!groupMap.has(cat)) groupMap.set(cat, [])
    groupMap.get(cat).push(item)
  })
  const result = []
  categoriesOrder.forEach(cat => {
    if (groupMap.has(cat)) {
      result.push({ name: cat, items: groupMap.get(cat) })
      groupMap.delete(cat)
    }
  })
  // 未分類・不明カテゴリ
  groupMap.forEach((its, cat) => result.push({ name: cat, items: its }))
  return result
}

// カテゴリグループの行数を計算
function catGroupRows(cat) {
  const showCat = !!(cat.name?.trim())
  return cat.items.length + (showCat ? 3 : 0) // カテゴリ行 + アイテム + 小計行 + 空白行
}

// 行数ベースで自動改ページ位置を計算
// 実際のページ行数（thead含む）: 1ページ目=20行、2ページ目以降=30行
// tbody行数 = 実際の行数 - 1(thead繰り返し分)
function calcAutoPageBreaks(catGroups, page1Rows = 20, pageNRows = 30) {
  const autoBreaks = new Set()
  let currentPageRows = 0
  let currentCapacity = page1Rows

  catGroups.forEach((cat, i) => {
    const showCat = !!(cat.name?.trim())
    const rows = catGroupRows(cat)

    if (i > 0 && showCat) {
      const remaining = currentCapacity - currentPageRows
      // 条件1: 大項目が下から3行目以内に来てしまう場合
      const headerInLast3 = remaining <= 3
      // 条件2: 小計だけが次ページへ移ってしまう場合
      // (ヘッダー＋全品目は収まるが小計行が収まらない = remaining === items + 1)
      const subtotalAloneOverflows = cat.items.length > 0 && remaining === cat.items.length + 1
      if (headerInLast3 || subtotalAloneOverflows) {
        autoBreaks.add(cat.name)
        currentPageRows = 0
        currentCapacity = pageNRows
      }
    }

    currentPageRows += rows
    // カテゴリ自体が複数ページにまたがる場合の位置調整
    while (currentPageRows > currentCapacity) {
      currentPageRows -= currentCapacity
      currentCapacity = pageNRows
    }
  })
  return autoBreaks
}

export default function QuotationPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [q, setQ] = useState(null)
  const [items, setItems] = useState([])
  const [creatorProfile, setCreatorProfile] = useState(null)
  const [approverProfile, setApproverProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(searchParams.get('dialog') === '1')
  const hasCover = true // EN様式（表紙あり）に固定
  const [pageBreakCats, setPageBreakCats] = useState(new Set())
  // 自動でON判定された改ページを、ユーザーが明示的に外した場合の除外セット
  const [excludedPageBreaks, setExcludedPageBreaks] = useState(new Set())
  const [printDate, setPrintDate] = useState('')
  const [printTitle, setPrintTitle] = useState('')
  const [termsDefault, setTermsDefault] = useState('')
  const [deliveryDefault, setDeliveryDefault] = useState('別途御打合せ')
  const [paymentDefault, setPaymentDefault] = useState('従来通り')
  const [validityDefault, setValidityDefault] = useState('発行後90日')

  useEffect(() => { load() }, [id])

  const isEmailCapture = searchParams.get('email') === '1'
  useEffect(() => {
    if (!isEmailCapture || loading || !q) return
    const timer = setTimeout(async () => {
      try {
        const el = document.getElementById('qprint')
        if (!el) { window.parent.postMessage({ type: 'quotation-screenshot', data: null }, '*'); return }
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          scrollX: 0,
          scrollY: 0,
        })
        const data = canvas.toDataURL('image/jpeg', 0.88).split(',')[1]
        window.parent.postMessage({ type: 'quotation-screenshot', data }, '*')
      } catch {
        window.parent.postMessage({ type: 'quotation-screenshot', data: null }, '*')
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [isEmailCapture, loading, q])

  async function load() {
    try {
      // ステップ1: 見積本体・明細・設定を並列取得
      const [quotationRes, itemsRes, settingsRes] = await Promise.all([
        supabase.from('quotations').select('*, customers(*), companies(*)').eq('id', id).single(),
        supabase.from('quotation_items').select('*').eq('quotation_id', id).order('sort_order'),
        supabase.from('settings').select('expense_defaults').single(),
      ])
      const quotation = quotationRes.data
      const its = itemsRes.data
      const stg = settingsRes.data

      // ステップ2: 作成者・承認者プロフィールを並列取得（必要なフィールドのみ）
      const approverId = quotation?.approved_by || quotation?.requested_approver_id
      const profileFields = 'id, name, email, signature_url, avatar_url, office_name, position, phone, role'
      const profilePromises = []
      if (quotation?.created_by) {
        profilePromises.push(
          supabase.from('profiles').select(profileFields).eq('id', quotation.created_by).single()
            .then(r => ({ kind: 'creator', data: r.data }))
        )
      }
      if (approverId && approverId !== quotation?.created_by) {
        profilePromises.push(
          supabase.from('profiles').select(profileFields).eq('id', approverId).single()
            .then(r => ({ kind: 'approver', data: r.data }))
        )
      }
      const profileResults = await Promise.all(profilePromises)
      for (const r of profileResults) {
        if (r.kind === 'creator') setCreatorProfile(r.data || null)
        if (r.kind === 'approver') setApproverProfile(r.data || null)
      }
      // 作成者=承認者のケース
      if (approverId && approverId === quotation?.created_by) {
        const cp = profileResults.find(r => r.kind === 'creator')?.data
        if (cp) setApproverProfile(cp)
      }

      setQ(quotation)
      setItems((its || []).map(i => {
        const qtyText = i.description?.startsWith('qty_text:') ? i.description.slice(9) : null
        return qtyText ? { ...i, quantity: qtyText } : i
      }))
      setPrintDate(quotation?.issue_date || '')
      setPrintTitle(quotation?.title || '')

      if (stg?.expense_defaults) {
        try {
          const def = JSON.parse(stg.expense_defaults)
          if (def.terms_default) setTermsDefault(def.terms_default)
          if (def.delivery_default) setDeliveryDefault(def.delivery_default)
          if (def.payment_default) setPaymentDefault(def.payment_default)
          if (def.validity_default) setValidityDefault(def.validity_default)
        } catch {}
      }
    } catch (e) {
      console.error('QuotationPrint load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const categoriesOrder = useMemo(() => {
    if (!q?.categories_json) return []
    try {
      const parsed = JSON.parse(q.categories_json)
      if (Array.isArray(parsed)) return parsed
      return parsed.list || []
    } catch { return [] }
  }, [q])

  const categoryEnNames = useMemo(() => {
    if (!q?.categories_json) return {}
    try {
      const parsed = JSON.parse(q.categories_json)
      return parsed.en_names || {}
    } catch { return {} }
  }, [q])

  const categoryDisplayNames = useMemo(() => {
    if (!q?.categories_json) return {}
    try {
      const parsed = JSON.parse(q.categories_json)
      return parsed.display_names || {}
    } catch { return {} }
  }, [q])

  const showSubSubtotals = useMemo(() => {
    if (!q?.categories_json) return false
    try {
      const parsed = JSON.parse(q.categories_json)
      if (typeof parsed.show_sub_subtotals === 'boolean') return parsed.show_sub_subtotals
    } catch {}
    // 旧フォーマット: spec === '__subcategory__:1' があれば表示扱い
    return (items || []).some(i => i.spec === '__subcategory__:1')
  }, [q, items])

  const showEnglishLabels = useMemo(() => {
    if (!q?.categories_json) return false
    try {
      const parsed = JSON.parse(q.categories_json)
      if (typeof parsed.show_english_labels === 'boolean') return parsed.show_english_labels
    } catch {}
    return false
  }, [q])

  // 整合性チェック：quotations.total（保存値）と quotation_items からの再計算が一致するか
  const integrityWarning = useMemo(() => {
    if (!q || !items?.length) return null
    const itemsSubtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0)
    const base = itemsSubtotal - Number(q.discount || 0) + Number(q.welfare_cost || 0)
    const isIncl = (q.price_display || (q.tax_type === 'taxable' ? 'incl' : 'excl')) === 'incl'
    const tax = isIncl ? Math.floor(base * Number(q.tax_rate) / 100) : 0
    const computed = base + tax
    const stored = Number(q.total || 0)
    // 1円以内の丸め誤差は許容
    if (Math.abs(computed - stored) <= 1) return null
    return { computed, stored }
  }, [q, items])

  const itemLabels = useMemo(() => {
    if (!q?.categories_json) return {}
    try {
      const parsed = JSON.parse(q.categories_json)
      return parsed.item_labels || {}
    } catch { return {} }
  }, [q])
  const welfareLabel = itemLabels.welfare || '法定福利費'
  const discountLabel = itemLabels.discount || '御値引き'

  const catGroups = useMemo(
    () => buildCatGroupsOrdered(items, categoriesOrder),
    [items, categoriesOrder]
  )

  const autoPageBreaks = useMemo(() => calcAutoPageBreaks(catGroups, hasCover ? 30 : 20), [catGroups, hasCover])

  const effectivePageBreaks = useMemo(
    () => {
      const s = new Set([...autoPageBreaks, ...pageBreakCats])
      excludedPageBreaks.forEach(c => s.delete(c))
      return s
    },
    [autoPageBreaks, pageBreakCats, excludedPageBreaks]
  )

  const pageBreakableCats = useMemo(
    () => catGroups.map(g => g.name).filter(n => n?.trim()).slice(1),
    [catGroups]
  )

  function toggleCat(cat) {
    const currentlyOn = effectivePageBreaks.has(cat)
    if (currentlyOn) {
      // OFFにする
      if (pageBreakCats.has(cat)) {
        // 手動追加だった場合は手動セットから削除
        setPageBreakCats(prev => {
          const next = new Set(prev)
          next.delete(cat)
          return next
        })
      }
      if (autoPageBreaks.has(cat)) {
        // 自動追加だった場合は除外セットに追加
        setExcludedPageBreaks(prev => new Set(prev).add(cat))
      }
    } else {
      // ONにする
      if (excludedPageBreaks.has(cat)) {
        // 除外していた自動分を復活
        setExcludedPageBreaks(prev => {
          const next = new Set(prev)
          next.delete(cat)
          return next
        })
      } else {
        // 新たに手動でON
        setPageBreakCats(prev => new Set(prev).add(cat))
      }
    }
  }

  function buildPdfFilename() {
    const date = (printDate || q?.issue_date || '').replace(/-/g, '').slice(0, 8)
    const title = (printTitle || q?.title || '').replace(/[\\/:*?"<>|]/g, '')
    return `${date}_${title}_10X`
  }

  function exportPdf() {
    const filename = buildPdfFilename()
    const original = document.title
    document.title = filename
    window.addEventListener('afterprint', () => { document.title = original }, { once: true })
    window.print()
  }

  function handlePrint() {
    setShowDialog(false)
    setTimeout(() => exportPdf(), 150)
  }

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )
  if (!q) return <div className="text-center py-12 text-gray-500">見積書が見つかりません</div>

  return (
    <div>
      <div className="no-print flex items-center justify-between mb-6">
        <button onClick={() => navigate('/quotations')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> 一覧に戻る
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-2 text-sm text-gray-500 border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50"
          >
            設定変更
          </button>
          <button
            onClick={() => exportPdf()}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Printer size={16} /> PDF出力
          </button>
        </div>
      </div>

      {/* 整合性チェック：保存済み合計と明細からの再計算が一致しない場合に警告（印刷には出ない） */}
      {integrityWarning && (
        <div className="no-print mb-4 mx-auto max-w-3xl bg-red-50 border-2 border-red-400 rounded-xl px-5 py-4">
          <p className="text-red-700 font-bold text-sm mb-1">⚠️ 合計金額の不整合を検出しました</p>
          <p className="text-red-600 text-xs leading-relaxed">
            保存されている合計（¥{integrityWarning.stored.toLocaleString('ja-JP')}）と、明細から再計算した合計（¥{integrityWarning.computed.toLocaleString('ja-JP')}）が一致しません。
            明細の重複・編集途中のデータが原因の可能性があります。<br />
            <b>このまま送付せず</b>、見積編集画面で明細を確認のうえ保存し直してください。
          </p>
        </div>
      )}

      {showDialog && (
        <div className="no-print fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800">PDF出力設定</h2>
              <button onClick={() => setShowDialog(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="mb-5 flex items-center gap-3">
              <span className="text-sm text-gray-600 whitespace-nowrap">発行日：</span>
              <input
                type="date"
                value={printDate}
                onChange={e => setPrintDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {pageBreakableCats.length > 0 && (
              <div className="mb-5">
                <p className="text-xs text-gray-400 mb-2">※ 行数から自動で改ページされます。手動で追加することも可能です。</p>
                {pageBreakableCats.map(cat => (
                  <label key={cat} className="flex items-center gap-3 py-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={effectivePageBreaks.has(cat)}
                      onChange={() => toggleCat(cat)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm text-gray-700">
                      {cat}を次ページの先頭へ
                      {autoPageBreaks.has(cat) && <span className="ml-1 text-xs text-blue-500">（自動）</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}

<div className="flex items-center justify-between">
              <button
                onClick={handlePrint}
                className="bg-blue-100 text-blue-700 font-medium px-8 py-2.5 rounded-xl hover:bg-blue-200"
              >
                プレビュー
              </button>
              <div className="flex gap-5 items-center">
                <button onClick={() => setShowDialog(false)} className="text-sm text-gray-500 hover:text-gray-700">
                  キャンセル
                </button>
                <button onClick={handlePrint} className="text-sm text-blue-600 font-semibold hover:text-blue-800">
                  出力する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        id="qprint"
        className="quotation-paper bg-white mx-auto"
        style={{ width: '210mm', minHeight: '297mm', padding: '12mm 12mm 12mm 10mm', fontFamily: FONT, fontSize: '9pt' }}
      >
        <QuotationBody
          q={q}
          items={items}
          catGroups={catGroups}
          effectivePageBreaks={effectivePageBreaks}
          printDate={printDate}
          printTitle={printTitle}
          creatorProfile={creatorProfile}
          approverProfile={approverProfile}
          isCapture={isEmailCapture}
          hasCover={hasCover}
          termsDefault={termsDefault}
          deliveryDefault={deliveryDefault}
          paymentDefault={paymentDefault}
          validityDefault={validityDefault}
          categoryEnNames={categoryEnNames}
          categoryDisplayNames={categoryDisplayNames}
          showSubSubtotals={showSubSubtotals}
          showEnglishLabels={showEnglishLabels}
          welfareLabel={welfareLabel}
          discountLabel={discountLabel}
        />
      </div>

      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          #qprint {
            width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            min-height: initial !important;
          }
          thead { display: table-header-group !important; }
          .cover-page { height: 267mm !important; }
        }
        @page {
          size: A4;
          margin: 12mm 12mm 18mm 10mm;
          @bottom-left {
            content: "${(q?.quotation_number || '').replace(/["\\\\]/g, '')} | ${(printTitle || q?.title || '').replace(/["\\\\]/g, '').slice(0, 50)}";
            font-size: 7pt;
            color: #888;
            font-family: serif;
          }
          @bottom-right {
            content: counter(page) " / " counter(pages);
            font-size: 7pt;
            color: #888;
            font-family: serif;
          }
        }
        @page :first {
          @bottom-left {
            content: none;
          }
        }
      `}</style>
    </div>
  )
}

const ACCENT_COLOR = '#ece8e1'

const CAT_EN_DEFAULTS = {
  '材料費': 'Premium Materials',
  '労務費': 'Expert Labor',
  '共通費': 'Management & Overheads',
}
// 管理費 role ↔ 英日（QuotationForm と同じ定義）
const PRINT_ROLE_TO_JP = { genba: '現場管理費', ippan: '一般管理費', anzen: '安全対策費', shokei: '諸経費' }
const PRINT_ROLE_TO_EN = { genba: 'Site Management', ippan: 'General Admin', anzen: 'Safety Cost', shokei: 'Misc Expenses' }
function printInferManagedRole(name = '') {
  if (name.includes('現場管理')) return 'genba'
  if (name.includes('一般管理')) return 'ippan'
  if (name.includes('安全対策') || name.includes('安全管理')) return 'anzen'
  if (name.includes('諸経費')) return 'shokei'
  return 'custom'
}
// 管理費アイテムの表示名（spec から role を取得し、英語表記ONなら "EN / JP"）
function printManagedName(item, showEnglish) {
  if (!item.spec?.startsWith('__managed__:')) return item.name
  const parts = item.spec.split(':')
  const role = parts[3] || printInferManagedRole(item.name)
  if (PRINT_ROLE_TO_JP[role]) {
    const jp = PRINT_ROLE_TO_JP[role]
    return showEnglish ? `${PRINT_ROLE_TO_EN[role]} / ${jp}` : jp
  }
  return item.name
}
const isManagedItem = (item) => item.spec?.startsWith('__managed__:')
// 雑材消耗品判定：新フォーマット(__misc__:) または 旧フォーマット(名前=雑材消耗品 かつ spec が数値)
const isMiscItem = (item) =>
  item.spec?.startsWith('__misc__:') ||
  (item.name === '雑材消耗品' && item.category === '材料費' && item.spec != null && !isNaN(Number(item.spec)))
// カテゴリの英語名のみを取得（無ければ空文字）
const catEnOnly = (name, enNames = {}, displayNames = {}) => {
  if (Object.prototype.hasOwnProperty.call(enNames, name)) return enNames[name] || ''
  if (displayNames[name]) return ''
  return CAT_EN_DEFAULTS[name] || ''
}
// 大項目小計のラベル： "English Subtotal / 日本語 小計"
const catSubtotalLabel = (name, enNames = {}, displayNames = {}) => {
  const jp = displayNames[name] || name
  const en = catEnOnly(name, enNames, displayNames)
  return en ? `${en} Subtotal / ${jp} 小計` : `${jp} 小計`
}
const catDisplayName = (name, enNames = {}, displayNames = {}) => {
  const jp = displayNames[name] || name
  // enNames に明示的にキーがあれば値を使う（空文字列は「英語なし」を意味する）
  if (Object.prototype.hasOwnProperty.call(enNames, name)) {
    return enNames[name] ? `${enNames[name]} / ${jp}` : jp
  }
  // 表示名（日本語）を変更している場合は既定英語を付けない
  if (displayNames[name]) return jp
  // それ以外は既定の英語名（標準カテゴリのみ）
  const defEn = CAT_EN_DEFAULTS[name]
  return defEn ? `${defEn} / ${jp}` : jp
}

function CoverPage({ q, catGroups, printDate, printTitle, creatorProfile, approverProfile, subtotal, discount, welfareCost, total, taxAmount, isTaxIncl, termsDefault = '', validityDefault = '発行後90日', categoryEnNames = {}, categoryDisplayNames = {}, welfareLabel = '法定福利費', discountLabel = '御値引き' }) {
  const customer = q.customers
  const c = q.companies
  const logoSize = Number(c?.pos1 || 10) * 4
  const stampSize = Number(c?.pos3 || 10) * 8
  const s = (obj) => ({ fontFamily: FONT, ...obj })
  const fmt = (n) => Number(n || 0).toLocaleString('ja-JP')
  const fmtD = (d) => {
    if (!d) return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-')
      return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`
    }
    const dt = new Date(d)
    return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
  }

  const displayDate = printDate || q.issue_date
  const displayTitle = printTitle || q.title
  const baseAmount = subtotal - discount + welfareCost
  const catRows = catGroups.filter(g => g.name?.trim())

  const thS = (align = 'left') => s({
    padding: '1.5mm 3mm', textAlign: align, fontSize: '6pt',
    letterSpacing: '0.1em', color: '#888', fontWeight: '600',
    borderBottom: '1.5px solid #333',
  })
  const tdS = (align = 'left', extra = {}) => s({
    padding: '1.2mm 3mm', textAlign: align, verticalAlign: 'middle',
    borderBottom: '0.5px solid #e0e0e0', ...extra,
  })

  return (
    <div style={s({ width: '100%', display: 'flex', flexDirection: 'column', pageBreakAfter: 'always', breakAfter: 'page', height: '267mm', overflow: 'hidden' })}>

      {/* ヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5mm' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3mm', marginBottom: c?.tagline ? '2mm' : 0 }}>
            {(c?.stamp_url || c?.logo_url) && (
              <img src={c.stamp_url || c.logo_url} alt="logo" style={{ height: '14mm', width: 'auto', objectFit: 'contain' }} />
            )}
          </div>
          {c?.tagline && (
            <div style={s({ fontSize: '7pt', letterSpacing: '0.18em', color: '#555' })}>{c.tagline}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={s({ fontSize: '8.5pt', color: '#555', marginBottom: '1.5mm', letterSpacing: '0.05em' })}>DATE: {fmtD(displayDate) || fmtD(new Date().toISOString().slice(0, 10))}</div>
          <div style={s({ fontSize: '26pt', fontStyle: 'italic', lineHeight: 1, color: '#1a1a1a' })}>Quotation</div>
          <div style={s({ fontSize: '9pt', letterSpacing: '0.4em', color: '#777', marginTop: '1mm' })}>御　見　積　書</div>
        </div>
      </div>

      {/* 区切り線 */}
      <div style={{ borderTop: '1.5px solid #222', marginBottom: '3mm' }} />

      {/* 宛先 / 発行元 */}
      <div style={{ display: 'flex', gap: '10mm', marginBottom: '3mm' }}>
        <div style={{ flex: '0 0 50%', overflow: 'visible' }}>
          <div style={s({ fontSize: '7pt', letterSpacing: '0.2em', color: '#888', marginBottom: '2mm' })}>PREPARED FOR / 宛先</div>
          {/* EN + JP 両方あり: EN上段・JP下段 */}
          {customer?.name_en && customer?.name && (<>
            <div style={s({ fontSize: customerFontSize(customer.name_en), fontWeight: 'bold', marginBottom: '0.5mm', whiteSpace: 'nowrap' })}>{customer.name_en}</div>
            <div style={s({ fontSize: customerFontSizeJP(customer.name + '　御中'), color: '#444', marginBottom: '1mm', whiteSpace: 'nowrap' })}>{customer.name}　御中</div>
          </>)}
          {/* JPのみ: JP上段に御中付き */}
          {!customer?.name_en && customer?.name && (
            <div style={s({ fontSize: customerFontSizeJP(customer.name + '　御中'), fontWeight: 'bold', color: '#444', marginBottom: '0.5mm', whiteSpace: 'nowrap' })}>{customer.name}　御中</div>
          )}
          {/* ENのみ: EN上段のみ */}
          {customer?.name_en && !customer?.name && (
            <div style={s({ fontSize: customerFontSize(customer.name_en), fontWeight: 'bold', marginBottom: '0.5mm', whiteSpace: 'nowrap' })}>{customer.name_en}</div>
          )}
          <div style={s({ fontSize: '8.5pt', color: '#555', lineHeight: '1.8' })}>
            {(customer?.address_en || customer?.address) && <div>{customer.address_en || customer.address}</div>}
            {customer?.phone && <div>T: {customer.phone}</div>}
          </div>
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={s({ fontSize: '7pt', letterSpacing: '0.2em', color: '#888', marginBottom: '2mm' })}>ISSUED BY / 発行</div>
          <div style={{ marginBottom: '1.5mm' }}>
            {c?.name_en && c?.name ? (<>
              <span style={s({ fontSize: '11pt', fontWeight: 'bold' })}>{c.name_en}</span>
              <span style={s({ fontSize: '9pt', fontWeight: 'normal', color: '#555' })}> / {c.name}</span>
            </>) : (
              <span style={s({ fontSize: '11pt', fontWeight: 'bold' })}>{c?.name_en || c?.name || ''}</span>
            )}
          </div>
          <div style={s({ fontSize: '8pt', color: '#444', lineHeight: '1.8', marginBottom: '3mm' })}>
            {c?.address_en && <div>{c.address_en}</div>}
            {c?.address_en2 && <div>{c.address_en2}</div>}
            {(creatorProfile?.phone || creatorProfile?.email) && (
              <div>
                {creatorProfile?.phone && `T: ${creatorProfile.phone}`}
                {creatorProfile?.phone && creatorProfile?.email && ' | '}
                {creatorProfile?.email && `E: ${creatorProfile.email}`}
              </div>
            )}
            {creatorProfile?.name && (
              <div>Prepared by {creatorProfile.name}</div>
            )}
          </div>
        </div>
      </div>

      {/* 件名 / 合計ボックス */}
      <div style={{ background: ACCENT_COLOR, color: '#1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', padding: '3mm 7mm', marginBottom: '3mm', borderRadius: '1mm' }}>
        <div style={{ flex: 1, paddingRight: '5mm', display: 'flex', flexDirection: 'column' }}>
          <div style={s({ fontSize: '6pt', letterSpacing: '0.2em', opacity: 0.75, marginBottom: '1.5mm' })}>PROJECT REFERENCE / 件名</div>
          <div style={s({ fontSize: '12pt', fontWeight: 'bold', lineHeight: 1.3 })}>{displayTitle}</div>
          <div style={{ marginTop: 'auto', paddingTop: '2mm' }}>
            <span style={s({ fontSize: '6pt', opacity: 0.75, letterSpacing: '0.1em' })}>REF NO.&ensp;</span>
            <span style={s({ fontWeight: '600', fontSize: '7pt' })}>{q.quotation_number}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div style={s({ fontSize: '6pt', letterSpacing: '0.2em', opacity: 0.75, marginBottom: '1mm' })}>GRAND TOTAL</div>
            <div style={s({ fontSize: '15pt', fontWeight: 'bold', lineHeight: 1 })}>¥{fmt(total)}</div>
          </div>
          <div style={{ paddingTop: '2mm' }}>
            <div style={s({ fontSize: '6.5pt', opacity: 0.8 })}>{isTaxIncl ? 'Including Tax (10%) / 税込' : '税別'}</div>
          </div>
        </div>
      </div>

      {/* 項目サマリーテーブル */}
      <table style={s({ width: '100%', borderCollapse: 'collapse', fontSize: '8pt', marginBottom: '7mm', tableLayout: 'fixed' })}>
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '53%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={thS('left')}>NO.</th>
            <th style={thS('left')}>SERVICE CLASSIFICATION / 項目</th>
            <th style={thS('center')}>QTY</th>
            <th style={thS('center')}>UNIT</th>
            <th style={thS('right')}>AMOUNT / 金額</th>
          </tr>
        </thead>
        <tbody>
          {/* 大項目（実際の件数分） */}
          {catRows.map((cat, i) => {
            const catTotal = cat.items.reduce((sum, item) => sum + Number(item.amount), 0)
            return (
              <tr key={i}>
                <td style={tdS('left', { color: '#888' })}>{String(i + 1).padStart(2, '0')}</td>
                <td style={tdS()}><div style={s({ fontWeight: '600' })}>{catDisplayName(cat.name, categoryEnNames, categoryDisplayNames)}</div></td>
                <td style={tdS('center', { color: '#555' })}>1.0</td>
                <td style={tdS('center', { color: '#555' })}>LS / 式</td>
                <td style={tdS('right', { fontWeight: '500' })}>{catTotal === 0 ? '¥0' : `¥${fmt(catTotal)}`}</td>
              </tr>
            )
          })}

          {/* 大項目直後：御値引き（0以外の場合のみ） */}
          {discount !== 0 && (
            <tr>
              <td style={tdS()}>{' '}</td>
              <td style={tdS('left', { color: '#c00' })}>Discount / {discountLabel}</td>
              <td style={tdS('center', { color: '#555' })}>1.0</td>
              <td style={tdS('center', { color: '#555' })}>LS / 式</td>
              <td style={tdS('right', { color: '#c00' })}>-¥{fmt(discount)}</td>
            </tr>
          )}

          {/* 大項目直後：法定福利費（0以外の場合のみ） */}
          {welfareCost !== 0 && (
            <tr>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>Welfare Contributions / {welfareLabel}</td>
              <td style={tdS('center', { color: '#555' })}>1.0</td>
              <td style={tdS('center', { color: '#555' })}>LS / 式</td>
              <td style={tdS('right')}>¥{fmt(welfareCost)}</td>
            </tr>
          )}

          {/* 残り空白行（合計12行になるよう埋める） */}
          {Array.from({ length: Math.max(0, 10 - catRows.length - (discount !== 0 ? 1 : 0) - (welfareCost !== 0 ? 1 : 0)) }).map((_, i) => (
            <tr key={`filler-${i}`}>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>{' '}</td>
            </tr>
          ))}

          <tr><td colSpan={5} style={{ borderTop: '1.5px solid #333', padding: 0 }}></td></tr>

          {/* 小計・消費税：消費税がある場合のみ表示 */}
          {isTaxIncl && taxAmount > 0 && (
            <>
              <tr>
                <td colSpan={4} style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '8pt', color: '#555' })}>Subtotal / 小計</td>
                <td style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '8pt' })}>¥{fmt(baseAmount)}</td>
              </tr>
              <tr>
                <td colSpan={4} style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '8pt', color: '#555' })}>Tax ({q.tax_rate}%) / 消費税</td>
                <td style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '8pt' })}>¥{fmt(taxAmount)}</td>
              </tr>
            </>
          )}

          <tr style={{ background: ACCENT_COLOR, color: '#1a1a1a' }}>
            <td colSpan={4} style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '9pt', fontWeight: 'bold', letterSpacing: '0.05em' })}>GRAND TOTAL / 合計</td>
            <td style={s({ padding: '1.5mm 3mm', textAlign: 'right', fontSize: '11pt', fontWeight: 'bold' })}>¥{fmt(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* フッター：注記 + 承認者 */}
      <div style={{ marginTop: '6mm', display: 'flex', gap: '10mm', paddingTop: '5mm', borderTop: '1px solid #ccc' }}>
        <div style={{ flex: 1 }}>
          <div style={s({ fontSize: '7pt', letterSpacing: '0.2em', color: '#888', marginBottom: '2mm' })}>TERMS & CONDITIONS / 注記</div>
          <div style={s({ fontSize: '8pt', color: '#444', marginBottom: '3mm' })}>
            <span style={{ color: '#888', fontSize: '7pt' }}>VALID&ensp;</span>
            <span style={{ fontWeight: '600' }}>{q.validity_period || validityDefault}</span>
          </div>
          {(c?.terms_en || termsDefault) ? (
            <div style={s({ fontSize: '8pt', color: '#444', lineHeight: '1.7', whiteSpace: 'pre-wrap' })}>{c?.terms_en || termsDefault}</div>
          ) : (
            <div style={s({ fontSize: '8pt', color: '#444', lineHeight: '1.7' })}>
              <div style={{ marginBottom: '2.5mm' }}>
                <div>01.&ensp;Any additional work will be performed on a T&amp;M basis.</div>
                <div style={{ paddingLeft: '8mm', color: '#666' }}>本見積には含まれない工事は別途見積となります。</div>
              </div>
              <div>
                <div>02.&ensp;PO &amp; payment shall be processed in JPY.</div>
                <div style={{ paddingLeft: '8mm', color: '#666' }}>ご発注・お支払いは記載の通貨にてお願い致します。</div>
              </div>
            </div>
          )}
        </div>
        <div style={{ width: '48mm', textAlign: 'center', flexShrink: 0 }}>
          <div style={s({ fontSize: '7pt', letterSpacing: '0.2em', color: '#888', marginBottom: '3mm' })}>AUTHORIZED SIGNATORY</div>
          {approverProfile?.signature_url && (
            <img src={approverProfile.signature_url} alt="サイン"
              style={{ height: '14mm', maxWidth: '44mm', objectFit: 'contain', objectPosition: 'center bottom', display: 'block', margin: '0 auto 1.5mm' }} />
          )}
          <div style={{ borderTop: '1px solid #888', paddingTop: '1.5mm' }}>
            <div style={s({ fontSize: '9.5pt', fontStyle: 'italic', fontWeight: '500' })}>{approverProfile?.name || ''}</div>
            {(c?.name_en || c?.name) && (
              <div style={s({ fontSize: '7.5pt', color: '#555', marginTop: '0.5mm' })}>
                {c.name_en || c.name}{approverProfile?.office_name ? ` / ${approverProfile.office_name}` : ''}
              </div>
            )}
            {approverProfile?.email && (
              <div style={s({ fontSize: '7pt', color: '#666', marginTop: '0.5mm' })}>{approverProfile.email}</div>
            )}
          </div>
        </div>
      </div>

      {/* キャッチコピー：フレックス末尾に押し付けてページ最下部に固定 */}
      <div style={{ marginTop: 'auto', paddingTop: '3mm', textAlign: 'center' }}>
        <div style={s({ fontSize: '8.5pt', fontStyle: 'italic', fontWeight: '600', color: '#333', marginBottom: '1mm' })}>
          &ldquo;Fulfilling the vision of excellence through engineering mastery.&rdquo;
        </div>
        <div style={s({ fontSize: '7.5pt', color: '#555' })}>
          10Xは、単なるサービス提供に留まらず、貴社のビジョンを具現化します。
        </div>
      </div>
    </div>
  )
}

function TableHeader({ s }) {
  const th = (align, width) => s({
    padding: '1.5mm 3mm', textAlign: align, width,
    fontSize: '6pt', letterSpacing: '0.1em', color: '#888',
    fontWeight: '600', border: '1px solid #999',
  })
  return (
    <thead>
      <tr style={{ background: ACCENT_COLOR }}>
        <th style={th('left', '52%')}>SERVICE CLASSIFICATION / 項目</th>
        <th style={th('center', '7%')}>QTY</th>
        <th style={th('center', '6%')}>UNIT</th>
        <th style={th('center', '18%')}>UNIT PRICE / 単価</th>
        <th style={th('right', '17%')}>AMOUNT / 金額</th>
      </tr>
    </thead>
  )
}

function QuotationBody({ q, items, catGroups, effectivePageBreaks = new Set(), printDate, printTitle, creatorProfile = null, approverProfile = null, isCapture = false, hasCover = false, termsDefault = '', deliveryDefault = '別途御打合せ', paymentDefault = '従来通り', validityDefault = '発行後90日', categoryEnNames = {}, categoryDisplayNames = {}, showSubSubtotals = false, showEnglishLabels = false, welfareLabel = '法定福利費', discountLabel = '御値引き' }) {
  const [extraAfter, setExtraAfter] = useState({})

  const showCtrl = !isCapture
  const addExtra = (key) => setExtraAfter(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
  const removeExtra = (key) => setExtraAfter(prev => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) - 1) }))

  const plusBtnStyle = {
    width: '15px', height: '15px', borderRadius: '50%',
    border: '1px solid #86efac', background: '#dcfce7', color: '#166534',
    cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', lineHeight: '1',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  }
  const minusBtnStyle = {
    width: '15px', height: '15px', borderRadius: '50%',
    border: '1px solid #fca5a5', background: '#fee2e2', color: '#991b1b',
    cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', lineHeight: '1',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  }
  const ctrlBtn = (posKey, isExtra = false) => showCtrl ? (
    <div className="no-print" style={{ position: 'absolute', left: '-20px', top: '50%', transform: 'translateY(-50%)', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center' }}>
      <button onClick={() => addExtra(posKey)} style={plusBtnStyle}>＋</button>
      {isExtra && <button onClick={() => removeExtra(posKey)} style={minusBtnStyle}>－</button>}
    </div>
  ) : null

  const c = q.companies
  const customer = q.customers
  const logoSize = Number(c?.pos1 || 10) * 4
  const stampSize = Number(c?.pos3 || 13) * 4

  const s = (obj) => ({ fontFamily: FONT, ...obj })

  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP') }
  function fmtDate(d) {
    if (!d) return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-')
      return `${y}年${Number(m)}月${Number(day)}日`
    }
    const dt = new Date(d)
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
  }

  const displayDate = printDate || q.issue_date
  const displayTitle = printTitle || q.title

  const subtotal = items.reduce((sum, i) => sum + Number(i.amount), 0)
  const discount = Number(q.discount || 0)
  const welfareCost = Number(q.welfare_cost || 0)
  const isTaxIncl = (q.price_display || (q.tax_type === 'taxable' ? 'incl' : 'excl')) === 'incl'
  const baseAmount = subtotal - discount + welfareCost
  const taxAmount = isTaxIncl ? Math.floor(baseAmount * Number(q.tax_rate) / 100) : 0
  // 合計は items から再計算（小計と同一の計算元に統一 — 保存値とのズレを防ぐ）
  const total = baseAmount + taxAmount
  const discountRows = discount !== 0 ? 1 : 0
  const welfareRows = welfareCost !== 0 ? 1 : 0
  const showApprover = approverProfile && approverProfile.id !== creatorProfile?.id

  const PAGEN_ROWS = 30
  const PAGE1_ROWS = hasCover ? PAGEN_ROWS : 20
  const LAST_PAGE_ROWS = q.notes ? 25 : PAGEN_ROWS
  let trackRows = 0
  let trackPage = 0

  // ページフィラー用（ボタンなし）
  const makeEmptyRow = (key) => (
    <tr key={key} style={{ height: '8mm' }}>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
    </tr>
  )

  // ユーザー追加の空白行（＋－ボタン付き）
  const makeExtraRow = (key, posKey) => (
    <tr key={key} style={{ height: '8mm' }}>
      <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
        {ctrlBtn(posKey, true)}
      </td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
      <td style={s({ border: '1px solid #999' })}></td>
    </tr>
  )

  const getCapacity = () => trackPage === 0 ? PAGE1_ROWS : PAGEN_ROWS

  const catTableRows = []

  const insertBreak = (key) => {
    const cap = getCapacity()
    const fill = Math.max(0, cap - trackRows)
    for (let fi = 0; fi < fill; fi++) catTableRows.push(makeEmptyRow(`pfill-${key}-${fi}`))
    catTableRows.push(
      <tr key={`pbind-${key}`} className="no-print">
        <td colSpan={5} style={{
          padding: '5px 8px', background: '#dbeafe',
          borderTop: '2px dashed #60a5fa', borderBottom: '2px dashed #60a5fa',
          textAlign: 'center', fontSize: '11px', color: '#1e40af', fontWeight: '600',
        }}>
          ── {trackPage + 2} ページ目 ──
        </td>
      </tr>
    )
    trackRows = 0
    trackPage++
  }

  // データ行を push し、その後ろにユーザー追加の空白行を挿入（ページ越えも自動対応）
  const pushRow = (row, posKey) => {
    catTableRows.push(row)
    trackRows++
    const count = extraAfter[posKey] || 0
    for (let ei = 0; ei < count; ei++) {
      if (trackRows >= getCapacity()) insertBreak(`${posKey}-x${ei}`)
      catTableRows.push(makeExtraRow(`extra-${posKey}-${ei}`, posKey))
      trackRows++
    }
  }

  const lastShowCatIndex = catGroups.reduce((last, cat, i) => (cat.name?.trim() ? i : last), -1)

  catGroups.forEach((cat, ci) => {
    const showCat = !!(cat.name?.trim())
    const doPageBreak = showCat && ci > 0 && effectivePageBreaks.has(cat.name)
    const catSubtotal = cat.items.reduce((acc, i) => acc + Number(i.amount), 0)

    if (doPageBreak) insertBreak(ci)

    if (showCat) {
      let forceBreak = doPageBreak
      if (!doPageBreak && trackRows >= getCapacity()) {
        insertBreak(`cat-${ci}`)
        forceBreak = true
      }
      pushRow(
        <tr key={`cat-${ci}`} style={{ ...(forceBreak ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}), height: '8mm' }}>
          <td colSpan={5} style={{ ...s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', fontSize: '8.5pt', verticalAlign: 'middle' }), position: 'relative', overflow: 'visible' }}>
            {ctrlBtn(`cat-${ci}`)}
            ■{catDisplayName(cat.name, categoryEnNames, categoryDisplayNames)}
          </td>
        </tr>,
        `cat-${ci}`
      )
    }

    // 中項目セクション小計の追跡用
    let activeSubHeader = null   // { name, amount }
    const flushSubSection = (isLastBeforeCatSubtotal = false) => {
      if (activeSubHeader && showSubSubtotals) {
        const subKey = `subsub-${ci}-${activeSubHeader.id}`
        // 中項目小計行：左詰、QTY/UNIT/PRICEセルは空のまま
        pushRow(
          <tr key={subKey} style={{ height: '8mm' }}>
            <td style={{ ...s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: '600', fontSize: '8pt', textAlign: 'left', verticalAlign: 'middle' }), position: 'relative', overflow: 'visible' }}>
              {ctrlBtn(subKey)}
              小計
            </td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', verticalAlign: 'middle' })}>
              {fmt(activeSubHeader.amount)}
            </td>
          </tr>,
          subKey
        )
        // 直後に空行を1つ挿入（+/-ボタン付き）
        // ただし「大項目小計の直前」かつ「空行を入れると大項目小計が次ページに溢れる」場合は空行をスキップ
        const cap = getCapacity()
        const wouldOverflow = isLastBeforeCatSubtotal && (trackRows + 1 + 1 > cap)
        if (!wouldOverflow) {
          const spKey = `subsub-sp-${ci}-${activeSubHeader.id}`
          pushRow(
            <tr key={spKey} style={{ height: '8mm' }}>
              <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
                {ctrlBtn(spKey, true)}
              </td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>,
            spKey
          )
        }
      }
      activeSubHeader = null
    }

    cat.items.forEach((item, ii) => {
      const isSubCat = item.spec === '__subcategory__' || item.spec === '__subcategory__:1'
      // 新しい中項目に切り替わる、または通常品目以外（固定行）が来たら、直前のセクションをフラッシュ
      if (isSubCat) {
        flushSubSection()
        if (showSubSubtotals) {
          activeSubHeader = { id: item.id || `${ci}-${ii}`, name: item.name, amount: 0 }
        }
      } else if (activeSubHeader) {
        // 通常明細：金額を加算
        activeSubHeader.amount += Number(item.amount || 0)
      }
      const showSpec = !isSubCat && item.spec && !/^__managed__:/.test(item.spec) && !/^__misc__:/.test(item.spec) && !/^\d+(\.\d+)?$/.test(item.spec)
      const qtyIsText = !isSubCat && typeof item.quantity === 'string' && item.quantity !== '' && isNaN(parseFloat(item.quantity))
      const posKey = `item-${ci}-${ii}`
      let forceBreak = false
      if (trackRows >= getCapacity()) {
        insertBreak(posKey)
        forceBreak = true
      }
      const managedItem = isManagedItem(item)
      const miscItem = isMiscItem(item)
      const displayName = isSubCat ? `【${item.name}】` : (managedItem ? printManagedName(item, showEnglishLabels) : item.name)
      const displayUnit = ((managedItem || miscItem) && showEnglishLabels) ? 'LS' : item.unit
      pushRow(
        <tr key={item.id} style={{ ...(forceBreak ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}), height: '8mm' }}>
          <td style={{ ...s({ border: '1px solid #999', padding: `0.5mm 2.5mm 0.5mm ${isSubCat ? '2.5mm' : '5mm'}`, verticalAlign: isSubCat ? 'middle' : 'top' }), position: 'relative', overflow: 'visible' }}>
            {ctrlBtn(posKey)}
            <div style={s({ fontSize: itemFontSize(displayName), whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: '1.25', fontWeight: isSubCat ? 'bold' : 'normal' })}>
              {displayName}
            </div>
            {showSpec && (
              <div style={s({ fontSize: '7pt', color: '#555', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: '1.25' })}>
                {item.spec}
              </div>
            )}
          </td>
          <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: qtyIsText ? 'center' : 'right', verticalAlign: 'middle' })}>
            {!isSubCat && (qtyIsText ? item.quantity : Number(item.quantity).toLocaleString())}
          </td>
          <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>
            {!isSubCat && (qtyIsText ? '−' : displayUnit)}
          </td>
          <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>
            {!isSubCat && (qtyIsText ? '−' : fmt(item.unit_price))}
          </td>
          <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>
            {!isSubCat && (qtyIsText ? '−' : fmt(item.amount))}
          </td>
        </tr>,
        posKey
      )
    })
    // カテゴリの末尾でも最後のサブセクションをフラッシュ（大項目小計が続くため、空行スキップ判定をする）
    flushSubSection(showCat)

    if (showCat) {
      const subKey = `sub-${ci}`
      pushRow(
        <tr key={subKey} style={{ height: '8mm' }}>
          <td style={{ ...s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', verticalAlign: 'middle' }), position: 'relative', overflow: 'visible' }}>
            {ctrlBtn(subKey)}
            {catSubtotalLabel(cat.name, categoryEnNames, categoryDisplayNames)}
          </td>
          <td style={s({ border: '1px solid #999' })}></td>
          <td style={s({ border: '1px solid #999' })}></td>
          <td style={s({ border: '1px solid #999' })}></td>
          <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', verticalAlign: 'middle' })}>{fmt(catSubtotal)}</td>
        </tr>,
        subKey
      )
      if (ci !== lastShowCatIndex) {
        const spKey = `sp-${ci}`
        pushRow(
          <tr key={spKey} style={{ height: '8mm' }}>
            <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
              {ctrlBtn(spKey, true)}
            </td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
          </tr>,
          spKey
        )
      }
    }
  })

  // フッター行（空行・値引き・福利費・消費税・空行・合計・空行）が現在のページに収まらない場合、先にページブレークを挿入
  const preFooterRowCount = 4 + (discount !== 0 ? 1 : 0) + (welfareCost !== 0 ? 1 : 0) + (isTaxIncl && taxAmount > 0 ? 1 : 0)
    + (extraAfter['pre-discount'] || 0) + (extraAfter['pre-grand-total'] || 0)
  let footerPageStartRow = trackRows
  let footerOnNewPage = false
  if (trackRows > 0 && trackRows + preFooterRowCount > getCapacity()) {
    insertBreak('pre-footer')
    footerPageStartRow = 0
    footerOnNewPage = true
  }
  const defaultPostFooterFill = Math.max(0, LAST_PAGE_ROWS - footerPageStartRow - preFooterRowCount)

  const isMultiPage = trackPage > 0
  const taxRows = (isTaxIncl && taxAmount > 0) ? 1 : 0

  return (
    <>
      {hasCover && (
        <CoverPage
          q={q}
          catGroups={catGroups}
          printDate={printDate}
          printTitle={printTitle}
          creatorProfile={creatorProfile}
          approverProfile={approverProfile}
          subtotal={subtotal}
          discount={discount}
          welfareCost={welfareCost}
          total={total}
          taxAmount={taxAmount}
          isTaxIncl={isTaxIncl}
          termsDefault={termsDefault}
          validityDefault={validityDefault}
          categoryEnNames={categoryEnNames}
          categoryDisplayNames={categoryDisplayNames}
          showSubSubtotals={showSubSubtotals}
          showEnglishLabels={showEnglishLabels}
          welfareLabel={welfareLabel}
          discountLabel={discountLabel}
        />
      )}
      {hasCover && (
        <div className="no-print" style={{
          width: '100%', padding: '5px 8px', background: '#dbeafe',
          borderTop: '2px dashed #60a5fa', borderBottom: '2px dashed #60a5fa',
          textAlign: 'center', fontSize: '11px', color: '#1e40af', fontWeight: '600',
          boxSizing: 'border-box',
        }}>
          ── 2 ページ目 ──
        </div>
      )}
      <div>
      {/*
        ⚠️ JP様式（御見積書タイトル＋単独ページレイアウト）はアーカイブに退避済み。
        EN様式（表紙あり）に固定しているため、ここでは何も描画しない。
        将来 JP様式を復活させる場合は src/_archived/QuotationPrint.JP-body.archive.txt を参照。
      */}

      {/* 明細：単一テーブル・theadが印刷時に各ページ先頭に自動繰り返し */}
      <table style={s({ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt', tableLayout: 'fixed', marginTop: 0 })}>
        <colgroup>
          <col style={{ width: '52%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '17%' }} />
        </colgroup>
        <TableHeader s={s} />
        <tbody>
          {catTableRows}

          {/* 最後の項目とフッターの間の空行（常に1行） */}
          <tr style={{ height: '8mm', ...(footerOnNewPage ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}) }}>
            <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
              {ctrlBtn('pre-discount')}
            </td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
          </tr>

          {/* pre-discount ユーザー追加行 */}
          {Array.from({ length: extraAfter['pre-discount'] || 0 }).map((_, i) => (
            <tr key={`pd-extra-${i}`} style={{ height: '8mm' }}>
              <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
                {ctrlBtn('pre-discount', true)}
              </td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          ))}

          {/* 値引き（最後の小計の下に表示） */}
          {discount !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Discount / {discountLabel}</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>1</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>{showEnglishLabels ? 'LS' : '式'}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
            </tr>
          )}

          {/* 法定福利費 */}
          {welfareCost !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Welfare Contributions / {welfareLabel}</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>1</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>{showEnglishLabels ? 'LS' : '式'}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(welfareCost)}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(welfareCost)}</td>
            </tr>
          )}

          {/* 消費税 */}
          {isTaxIncl && taxAmount > 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Tax ({q.tax_rate}%) / 消費税</td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(taxAmount)}</td>
            </tr>
          )}

          {/* 合計の前の空行 */}
          <tr style={{ height: '8mm' }}>
            <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
              {ctrlBtn('pre-grand-total')}
            </td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
          </tr>

          {/* pre-grand-total ユーザー追加行 */}
          {Array.from({ length: extraAfter['pre-grand-total'] || 0 }).map((_, i) => (
            <tr key={`pgt-extra-${i}`} style={{ height: '8mm' }}>
              <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
                {ctrlBtn('pre-grand-total', true)}
              </td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          ))}

          {/* 合計 */}
          <tr style={{ height: '8mm' }}>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', verticalAlign: 'middle' })}>GRAND TOTAL / 合計</td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', verticalAlign: 'middle' })}>{fmt(total)}</td>
          </tr>

          {/* 合計の後の空行（+ボタン付き） */}
          <tr style={{ height: '8mm' }}>
            <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
              {ctrlBtn('post-footer')}
            </td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
          </tr>

          {/* 備考あり最終ページ: GRAND TOTAL下に空行を詰めて25行に合わせる（+ボタン付き） */}
          {Array.from({ length: defaultPostFooterFill }).map((_, i) => (
            <tr key={`pf-default-${i}`} style={{ height: '8mm' }}>
              <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
                {ctrlBtn('post-footer')}
              </td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          ))}

          {/* ユーザー追加の空行（+－ボタン付き） */}
          {Array.from({ length: extraAfter['post-footer'] || 0 }).map((_, i) => (
            <tr key={`pf-extra-${i}`} style={{ height: '8mm' }}>
              <td style={{ ...s({ border: '1px solid #999' }), position: 'relative', overflow: 'visible' }}>
                {ctrlBtn('post-footer', true)}
              </td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* TERMS & CONDITIONS */}
      {q.notes && (
        <div style={s({ marginTop: '5mm', fontSize: '8.5pt', border: '1px solid #999', width: '100%', boxSizing: 'border-box' })}>
          <div style={s({ fontWeight: '600', padding: '1.5mm 3mm', borderBottom: '1px solid #999', background: ACCENT_COLOR, fontSize: '6pt', letterSpacing: '0.1em', color: '#888' })}>TERMS &amp; CONDITIONS / 注記</div>
          <div style={s({ whiteSpace: 'pre-wrap', color: '#333', padding: '2mm 3mm' })}>
            {q.notes}
          </div>
        </div>
      )}

      {c?.bank_info && (
        <div style={s({ marginTop: '4mm', fontSize: '8pt', color: '#444' })}>
          <div style={s({ fontWeight: 'bold', marginBottom: '1mm' })}>振込先</div>
          <div style={s({ whiteSpace: 'pre-wrap' })}>{c.bank_info}</div>
        </div>
      )}
      </div>
    </>
  )
}
