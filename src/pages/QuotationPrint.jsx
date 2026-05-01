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
  const [pageBreakCats, setPageBreakCats] = useState(new Set())
  const [printDate, setPrintDate] = useState('')
  const [printTitle, setPrintTitle] = useState('')

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
      const { data: quotation } = await supabase
        .from('quotations')
        .select('*, customers(*), companies(*)')
        .eq('id', id)
        .single()
      const { data: its } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', id)
        .order('sort_order')

      if (quotation?.created_by) {
        const { data: cp } = await supabase.from('profiles').select('*').eq('id', quotation.created_by).single()
        setCreatorProfile(cp || null)
      }
      if (quotation?.approved_by) {
        const { data: ap } = await supabase.from('profiles').select('*').eq('id', quotation.approved_by).single()
        setApproverProfile(ap || null)
      }

      setQ(quotation)
      setItems((its || []).map(i => {
        const qtyText = i.description?.startsWith('qty_text:') ? i.description.slice(9) : null
        return qtyText ? { ...i, quantity: qtyText } : i
      }))
      setPrintDate(quotation?.issue_date || '')
      setPrintTitle(quotation?.title || '')
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

  const catGroups = useMemo(
    () => buildCatGroupsOrdered(items, categoriesOrder),
    [items, categoriesOrder]
  )

  const autoPageBreaks = useMemo(() => calcAutoPageBreaks(catGroups), [catGroups])

  const effectivePageBreaks = useMemo(
    () => new Set([...autoPageBreaks, ...pageBreakCats]),
    [autoPageBreaks, pageBreakCats]
  )

  const pageBreakableCats = useMemo(
    () => catGroups.map(g => g.name).filter(n => n?.trim()).slice(1),
    [catGroups]
  )

  function toggleCat(cat) {
    setPageBreakCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function buildPdfFilename() {
    const date = (printDate || q?.issue_date || '').replace(/-/g, '').slice(0, 8)
    const customer = q?.customers?.name || ''
    const title = (printTitle || q?.title || '').replace(/[\\/:*?"<>|]/g, '')
    return `${date}_${customer}御中_${title}_10X`
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
        style={{ width: '210mm', minHeight: '297mm', padding: '12mm 14mm 12mm 14mm', fontFamily: FONT, fontSize: '9pt' }}
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
        }
        @page {
          size: A4;
          margin: 12mm 14mm 18mm 14mm;
          @bottom-right {
            content: "page " counter(page) "/" counter(pages);
            font-family: 'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', serif;
            font-size: 7.5pt;
            color: #666;
          }
        }
      `}</style>
    </div>
  )
}

function TableHeader({ s }) {
  return (
    <thead>
      <tr style={{ background: '#f0f0f0' }}>
        <th style={s({ border: '1px solid #999', padding: '1.5mm 2.5mm', textAlign: 'left', width: '52%', fontWeight: 'bold' })}>名称/仕様</th>
        <th style={s({ border: '1px solid #999', padding: '1.5mm 1mm', textAlign: 'center', width: '7%', fontWeight: 'bold' })}>数量</th>
        <th style={s({ border: '1px solid #999', padding: '1.5mm 1mm', textAlign: 'center', width: '6%', fontWeight: 'bold' })}>単位</th>
        <th style={s({ border: '1px solid #999', padding: '1.5mm 2.5mm', textAlign: 'center', width: '18%', fontWeight: 'bold' })}>単価</th>
        <th style={s({ border: '1px solid #999', padding: '1.5mm 2.5mm', textAlign: 'center', width: '17%', fontWeight: 'bold' })}>金額</th>
      </tr>
    </thead>
  )
}

function QuotationBody({ q, items, catGroups, effectivePageBreaks = new Set(), printDate, printTitle, creatorProfile = null, approverProfile = null, isCapture = false }) {
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
  const total = Number(q.total || 0)
  const discountRows = discount !== 0 ? 1 : 0
  const welfareRows = welfareCost !== 0 ? 1 : 0
  const showApprover = approverProfile && approverProfile.id !== creatorProfile?.id

  const PAGE1_ROWS = 20
  const PAGEN_ROWS = 30
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
            ■{cat.name}
          </td>
        </tr>,
        `cat-${ci}`
      )
    }

    cat.items.forEach((item, ii) => {
      const isSubCat = item.spec === '__subcategory__'
      const showSpec = !isSubCat && item.spec && !/^__managed__:/.test(item.spec) && !/^\d+(\.\d+)?$/.test(item.spec)
      const qtyIsText = !isSubCat && typeof item.quantity === 'string' && item.quantity !== '' && isNaN(parseFloat(item.quantity))
      const posKey = `item-${ci}-${ii}`
      let forceBreak = false
      if (trackRows >= getCapacity()) {
        insertBreak(posKey)
        forceBreak = true
      }
      pushRow(
        <tr key={item.id} style={{ ...(forceBreak ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}), height: '8mm' }}>
          <td style={{ ...s({ border: '1px solid #999', padding: `0.5mm 2.5mm 0.5mm ${isSubCat ? '2.5mm' : '5mm'}`, verticalAlign: isSubCat ? 'middle' : 'top' }), position: 'relative', overflow: 'visible' }}>
            {ctrlBtn(posKey)}
            <div style={s({ fontSize: itemFontSize(item.name), whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: '1.25', fontWeight: isSubCat ? 'bold' : 'normal' })}>
              {isSubCat ? `〈${item.name}〉` : item.name}
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
            {!isSubCat && (qtyIsText ? '−' : item.unit)}
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

    if (showCat) {
      const subKey = `sub-${ci}`
      pushRow(
        <tr key={subKey} style={{ height: '8mm' }}>
          <td style={{ ...s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', verticalAlign: 'middle' }), position: 'relative', overflow: 'visible' }}>
            {ctrlBtn(subKey)}
            【小計】
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

  const isMultiPage = trackPage > 0
  const taxRows = (isTaxIncl && taxAmount > 0) ? 1 : 0
  const totalRow = 1
  const lastCapacity = isMultiPage
    ? (!!q?.notes ? 25 : PAGEN_ROWS)
    : (!!q?.notes ? 15 : PAGE1_ROWS)
  const fillerCount = Math.max(0, lastCapacity - trackRows - discountRows - welfareRows - taxRows - totalRow)

  return (
    <div style={s({})}>
      {/* タイトル */}
      <div style={s({ textAlign: 'center', marginBottom: '3mm' })}>
        <span style={s({ fontSize: '22pt', fontWeight: 'bold', letterSpacing: '0.15em' })}>御 見 積 書</span>
      </div>

      {/* ヘッダー：左右2カラム */}
      <div style={s({ display: 'flex', gap: '6mm', marginBottom: '1mm' })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s({ marginBottom: '2mm' })}>
            <span style={s({
              fontSize: customerFontSize(customer?.name || ''),
              fontWeight: 'bold',
              borderBottom: '2px solid black',
              paddingBottom: '0.5mm',
              display: 'inline-block',
              whiteSpace: 'nowrap',
            })}>
              {customer?.name || '（顧客未設定）'}　御中
            </span>
          </div>

          <div style={s({ fontSize: '8.5pt', color: '#333', marginBottom: '3mm', lineHeight: '1.6', whiteSpace: 'pre-line' })}>
            {q.greeting || '毎度御引立て賜り、誠に有難う御座います。\n下記の通り御見積申しあげます。'}
          </div>

          <div style={s({ display: 'flex', alignItems: 'flex-end', marginBottom: '3mm', borderBottom: '1px solid #999', paddingBottom: '1mm' })}>
            <span style={s({ whiteSpace: 'nowrap', marginRight: '2mm', fontSize: '9.5pt', flexShrink: 0 })}>件　名：</span>
            <span style={s({ fontSize: titleFontSize(displayTitle), fontWeight: 'bold', lineHeight: '1.5', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word', flex: 1, minWidth: 0 })}>
              {displayTitle}
            </span>
          </div>

          <div style={s({ marginBottom: '3mm', display: 'inline-block', borderBottom: '1.5px solid #555', paddingBottom: '1mm' })}>
            <div style={s({ display: 'flex', alignItems: 'baseline', gap: '2mm' })}>
              <span style={s({ fontSize: '9.5pt', whiteSpace: 'nowrap' })}>見 積 金 額：</span>
              <span style={s({ fontSize: '17pt', fontWeight: 'bold' })}>¥{fmt(total)}</span>
              <span style={s({ fontSize: '8.5pt', color: '#444' })}>（{isTaxIncl ? '税込' : '税別'}）</span>
            </div>
          </div>

          {[
            ['納　　　期', q.delivery_terms || '別途御打合せ'],
            ['御 支 払 条 件', q.payment_terms || '従来通り'],
            ['見積有効期間', q.validity_period || '発行後90日'],
          ].map(([label, value]) => (
            <div key={label} style={s({ display: 'flex', alignItems: 'baseline', marginBottom: '1.5mm', borderBottom: '1px solid #ccc', paddingBottom: '0.5mm' })}>
              <span style={s({ whiteSpace: 'nowrap', minWidth: '22mm', fontSize: '8.5pt' })}>{label}：</span>
              <span style={s({ fontSize: '8.5pt' })}>{value}</span>
            </div>
          ))}

          {/* ※ 消費税注記 — 有効期間の直下に表示 */}
          {!isTaxIncl && (
            <div style={s({ fontSize: '8.5pt', fontWeight: 'bold', marginTop: '1.5mm' })}>
              ※ 本御見積には消費税は含まれておりません。
            </div>
          )}
        </div>

        <div style={{ width: '68mm', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <table style={s({ width: '100%', borderCollapse: 'collapse', marginBottom: '3mm', fontSize: '8.5pt' })}>
            <tbody>
              <tr>
                <td style={s({ border: '1px solid #999', padding: '1mm 2.5mm', background: '#f5f5f5', whiteSpace: 'nowrap' })}>見積番号</td>
                <td style={s({ border: '1px solid #999', padding: '1mm 2.5mm' })}>{q.quotation_number}</td>
              </tr>
              <tr>
                <td style={s({ border: '1px solid #999', padding: '1mm 2.5mm', background: '#f5f5f5', whiteSpace: 'nowrap' })}>発行日</td>
                <td style={s({ border: '1px solid #999', padding: '1mm 2.5mm' })}>{fmtDate(displayDate)}</td>
              </tr>
            </tbody>
          </table>

          {c && (
            <div style={{ position: 'relative', marginBottom: '3mm' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '2mm', flexWrap: 'nowrap' }}>
                {c.logo_url && (
                  <img src={c.logo_url} alt="ロゴ"
                    style={{ width: `${logoSize}px`, height: `${logoSize}px`, objectFit: 'contain', flexShrink: 0, minWidth: `${logoSize}px` }} />
                )}
                <div style={s({ fontSize: '7.5pt', lineHeight: '1.55', color: '#333' })}>
                  <div style={s({ fontWeight: 'bold', fontSize: '9.5pt', color: '#000' })}>{c.name}</div>
                  {c.postal_code && <div>〒{c.postal_code}</div>}
                  {c.address && <div style={{ whiteSpace: 'nowrap' }}>{c.address}</div>}
                  {c.phone && <div>TEL　{c.phone}</div>}
                  {c.fax && <div>FAX　{c.fax}</div>}
                </div>
              </div>
              {c.stamp_url && (
                <img src={c.stamp_url} alt="印鑑"
                  style={{ position: 'absolute', top: 0, right: 0, width: `${stampSize}px`, height: `${stampSize}px`, objectFit: 'contain', opacity: 0.85 }} />
              )}
            </div>
          )}

          {/* Prepared by / Approver — 右カラム末尾 */}
          <div style={{ marginTop: 'auto', ...s({ fontSize: '7.5pt', color: '#444', textAlign: 'right' }) }}>
            <div style={{ marginBottom: showApprover ? '2mm' : 0 }}>
              {creatorProfile?.signature_url && (
                <div style={{ borderBottom: '1px solid #888', marginBottom: '0.5mm', display: 'inline-block', width: '100%' }}>
                  <img src={creatorProfile.signature_url} alt="担当サイン"
                    style={{ display: 'block', height: '11mm', maxWidth: '42mm', objectFit: 'contain', objectPosition: 'center bottom', opacity: 0.9, margin: '0 auto' }} />
                </div>
              )}
              <span style={{ whiteSpace: 'nowrap' }}>
                Prepared by: <span style={{ color: '#555' }}>{creatorProfile?.name || ''}</span>
              </span>
            </div>
            {showApprover && (
              <div>
                {approverProfile?.signature_url && (
                  <div style={{ borderBottom: '1px solid #888', marginBottom: '0.5mm', display: 'inline-block', width: '100%' }}>
                    <img src={approverProfile.signature_url} alt="承認者サイン"
                      style={{ display: 'block', height: '11mm', maxWidth: '42mm', objectFit: 'contain', objectPosition: 'center bottom', opacity: 0.9, margin: '0 auto' }} />
                  </div>
                )}
                <span style={{ whiteSpace: 'nowrap' }}>
                  Approver: <span style={{ color: '#555' }}>{approverProfile?.name || ''}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

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

          {/* 小計と値引きの間の空行 */}
          {discount !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          )}

          {/* 値引き（最後の小計の下に表示） */}
          {discount !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm', verticalAlign: 'top' })}>御値引き</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>1</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>式</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
            </tr>
          )}

          {/* 法定福利費 */}
          {welfareCost !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm', verticalAlign: 'top' })}>法定福利費</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>1</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>式</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(welfareCost)}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(welfareCost)}</td>
            </tr>
          )}

          {/* 空白行（最終ページを埋める） */}
          {Array.from({ length: fillerCount }).map((_, i) => (
            <tr key={`filler-${i}`} style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
            </tr>
          ))}

          {/* 消費税 */}
          {isTaxIncl && taxAmount > 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', verticalAlign: 'middle' })}>消費税（{q.tax_rate}%）</td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(taxAmount)}</td>
            </tr>
          )}

          {/* 合計 */}
          <tr style={{ height: '8mm' }}>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', fontSize: '10.5pt', verticalAlign: 'middle' })}>【合　計】</td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', fontSize: '10.5pt', verticalAlign: 'middle' })}>{fmt(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* 備考 */}
      {q.notes && (
        <div style={s({ marginTop: '5mm', fontSize: '8.5pt' })}>
          <div style={s({ fontWeight: 'bold', marginBottom: '1mm' })}>備考</div>
          <div style={s({ whiteSpace: 'pre-wrap', color: '#333', border: '1px solid #ccc', padding: '2mm 3mm', width: '100%', boxSizing: 'border-box' })}>
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
  )
}
