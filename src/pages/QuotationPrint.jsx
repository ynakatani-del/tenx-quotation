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
  const hasCover = searchParams.get('cover') !== '0'
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

  const autoPageBreaks = useMemo(() => calcAutoPageBreaks(catGroups, hasCover ? 30 : 20), [catGroups, hasCover])

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
            onClick={() => {
              const url = new URL(window.location.href)
              if (url.searchParams.get('cover') === '0') url.searchParams.delete('cover')
              else url.searchParams.set('cover', '0')
              window.location.href = url.toString()
            }}
            className="flex items-center text-sm border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 font-semibold tracking-wide"
          >
            <span className={hasCover ? 'text-gray-400' : 'text-blue-600'}>JP</span>
            <span className="text-gray-300 mx-0.5">/</span>
            <span className={hasCover ? 'text-blue-600' : 'text-gray-400'}>EN</span>
          </button>
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
        style={{ width: '210mm', minHeight: '297mm', padding: '12mm 10mm 12mm 10mm', fontFamily: FONT, fontSize: '9pt' }}
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
          margin: 12mm 10mm 18mm 10mm;
          @bottom-right {
            content: "page " counter(page) "/" counter(pages);
            font-family: 'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', serif;
            font-size: 7.5pt;
            color: #666;
          }
          @bottom-left {
            content: "REF No: ${q?.quotation_number || ''}　PROJECT REFERENCE: ${(printTitle || q?.title || '').replace(/"/g, '\\"')}";
            font-family: 'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', serif;
            font-size: 7pt;
            color: #666;
          }
        }
        @page :first {
          @bottom-left { content: none; }
        }
      `}</style>
    </div>
  )
}

const ACCENT_COLOR = '#ece8e1'

function CoverPage({ q, catGroups, printDate, printTitle, creatorProfile, subtotal, discount, welfareCost, total, taxAmount, isTaxIncl }) {
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
            <div style={s({ fontSize: customerFontSize(customer.name + '　御中'), color: '#555', marginBottom: '1mm', whiteSpace: 'nowrap' })}>{customer.name}　御中</div>
          </>)}
          {/* JPのみ: JP上段に御中付き */}
          {!customer?.name_en && customer?.name && (
            <div style={s({ fontSize: customerFontSize(customer.name + '　御中'), fontWeight: 'bold', marginBottom: '0.5mm', whiteSpace: 'nowrap' })}>{customer.name}　御中</div>
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
            {(c?.phone || creatorProfile?.email) && (
              <div>
                {c?.phone && `T: ${c.phone}`}
                {c?.phone && creatorProfile?.email && ' | '}
                {creatorProfile?.email && `E: ${creatorProfile.email}`}
              </div>
            )}
            {c?.website && <div>{c.website}</div>}
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
                <td style={tdS()}><div style={s({ fontWeight: '600' })}>{cat.name}</div></td>
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
              <td style={tdS('left', { color: '#c00' })}>Discount / 御値引き</td>
              <td style={tdS('center', { color: '#555' })}>1.0</td>
              <td style={tdS('center', { color: '#555' })}>LS / 式</td>
              <td style={tdS('right', { color: '#c00' })}>-¥{fmt(discount)}</td>
            </tr>
          )}

          {/* 大項目直後：法定福利費（0以外の場合のみ） */}
          {welfareCost !== 0 && (
            <tr>
              <td style={tdS()}>{' '}</td>
              <td style={tdS()}>Welfare Contributions / 法定福利費</td>
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
            <span style={{ fontWeight: '600' }}>{q.validity_period || '発行後90日'}</span>
          </div>
          {c?.terms_en ? (
            <div style={s({ fontSize: '8pt', color: '#444', lineHeight: '1.7', whiteSpace: 'pre-wrap' })}>{c.terms_en}</div>
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
          {creatorProfile?.signature_url && (
            <img src={creatorProfile.signature_url} alt="サイン"
              style={{ height: '14mm', maxWidth: '44mm', objectFit: 'contain', objectPosition: 'center bottom', display: 'block', margin: '0 auto 1.5mm' }} />
          )}
          <div style={{ borderTop: '1px solid #888', paddingTop: '1.5mm' }}>
            <div style={s({ fontSize: '9.5pt', fontStyle: 'italic', fontWeight: '500' })}>{creatorProfile?.name || ''}</div>
          </div>
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

function QuotationBody({ q, items, catGroups, effectivePageBreaks = new Set(), printDate, printTitle, creatorProfile = null, approverProfile = null, isCapture = false, hasCover = false }) {
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

  const PAGEN_ROWS = 30
  const PAGE1_ROWS = hasCover ? PAGEN_ROWS : 20
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
            Subtotal / 小計
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

  // フッター行（セパレータ・値引き・福利費・消費税・合計）が現在のページに収まらない場合、先にページブレークを挿入
  const preFooterRowCount = (discount !== 0 ? 2 : 0) + (welfareCost !== 0 ? 1 : 0) + (isTaxIncl && taxAmount > 0 ? 1 : 0) + 1
  if (trackRows > 0 && trackRows + preFooterRowCount > getCapacity()) {
    insertBreak('pre-footer')
  }

  const isMultiPage = trackPage > 0
  const taxRows = (isTaxIncl && taxAmount > 0) ? 1 : 0
  const totalRow = 1
  const lastCapacity = isMultiPage
    ? (!!q?.notes ? 25 : PAGEN_ROWS)
    : (!!q?.notes ? 15 : PAGE1_ROWS)
  const fillerCount = Math.max(0, lastCapacity - trackRows - discountRows - welfareRows - taxRows - totalRow)

  return (
    <>
      {hasCover && (
        <CoverPage
          q={q}
          catGroups={catGroups}
          printDate={printDate}
          printTitle={printTitle}
          creatorProfile={creatorProfile}
          subtotal={subtotal}
          discount={discount}
          welfareCost={welfareCost}
          total={total}
          taxAmount={taxAmount}
          isTaxIncl={isTaxIncl}
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
      {!hasCover && (<>
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
            {q.greeting || c?.display_name || '毎度御引立て賜り、誠に有難う御座います。\n下記の通り御見積申しあげます。'}
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
      </>)}

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
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Discount / 御値引き</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>1</td>
              <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>式</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
            </tr>
          )}

          {/* 法定福利費 */}
          {welfareCost !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Welfare Contributions / 法定福利費</td>
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
              <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm 0.5mm 5mm', verticalAlign: 'top' })}>Tax ({q.tax_rate}%) / 消費税</td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(taxAmount)}</td>
            </tr>
          )}

          {/* 合計 */}
          <tr style={{ height: '8mm' }}>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', verticalAlign: 'middle' })}>GRAND TOTAL / 合計</td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999' })}></td>
            <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', verticalAlign: 'middle' })}>{fmt(total)}</td>
          </tr>
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
