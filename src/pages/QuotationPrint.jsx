import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Printer, ArrowLeft, X } from 'lucide-react'

const FONT = "'Yu Mincho', 'Hiragino Mincho ProN', 'MS Mincho', serif"

function titleFontSize(title = '') {
  if (title.length > 50) return '8pt'
  if (title.length > 35) return '9pt'
  return '10pt'
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

// 行数ベースで自動改ページ位置を計算（1ページ目20行、2ページ目以降30行）
function calcAutoPageBreaks(catGroups, page1Rows = 20, pageNRows = 30) {
  const autoBreaks = new Set()
  let currentPageRows = 0
  let currentCapacity = page1Rows

  catGroups.forEach((cat, i) => {
    const rows = catGroupRows(cat)
    if (i > 0 && currentPageRows + rows > currentCapacity) {
      autoBreaks.add(cat.name)
      currentPageRows = rows
      currentCapacity = pageNRows
    } else {
      currentPageRows += rows
    }
  })
  return autoBreaks
}

// 最終ページの空白行数を計算
function calcFillerRows(catGroups, effectiveBreaks, hasNotes) {
  let isMultiPage = false
  let lastPageRows = 0

  catGroups.forEach((cat, ci) => {
    const showCat = !!(cat.name?.trim())
    const isBreak = showCat && ci > 0 && effectiveBreaks.has(cat.name)
    if (isBreak) { isMultiPage = true; lastPageRows = 0 }
    lastPageRows += catGroupRows(cat)
  })

  const target = isMultiPage
    ? (hasNotes ? 25 : 30)
    : (hasNotes ? 15 : 20)
  return Math.max(0, target - lastPageRows)
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
      setItems(its || [])
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
    try { return JSON.parse(q.categories_json) } catch { return [] }
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

  const catNames = useMemo(
    () => [...new Set(items.map(i => i.category || '').filter(c => c.trim() !== ''))],
    [items]
  )
  const pageBreakableCats = catNames.slice(1)

  function toggleCat(cat) {
    setPageBreakCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function handlePrint() {
    setShowDialog(false)
    setTimeout(() => window.print(), 150)
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
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <Printer size={16} /> 印刷する
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

            <div className="mb-7">
              <label className="block text-sm text-gray-600 mb-1">件名入力</label>
              <input
                type="text"
                value={printTitle}
                onChange={e => setPrintTitle(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowDialog(false)}
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
        @page { size: A4; margin: 12mm 14mm; }
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

function QuotationBody({ q, items, catGroups, effectivePageBreaks = new Set(), printDate, printTitle, creatorProfile = null, approverProfile = null }) {
  const c = q.companies
  const customer = q.customers
  const logoSize = Number(c?.pos1 || 10) * 4
  const stampSize = Number(c?.pos3 || 13) * 4

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

  const subtotal = items.reduce((s, i) => s + Number(i.amount), 0)
  const discount = Number(q.discount || 0)
  const welfareCost = Number(q.welfare_cost || 0)
  const isTaxIncl = (q.price_display || (q.tax_type === 'taxable' ? 'incl' : 'excl')) === 'incl'
  const baseAmount = subtotal - discount + welfareCost
  const taxAmount = isTaxIncl ? Math.floor(baseAmount * Number(q.tax_rate) / 100) : 0
  const total = Number(q.total || 0)

  const discountRows = discount !== 0 ? 1 : 0
  const welfareRows = welfareCost !== 0 ? 1 : 0
  const fillerCount = Math.max(0, calcFillerRows(catGroups, effectivePageBreaks, !!q?.notes) - discountRows - welfareRows)

  const s = (obj) => ({ fontFamily: FONT, ...obj })

  return (
    <div style={s({})}>
      {/* タイトル */}
      <div style={s({ textAlign: 'center', marginBottom: '3mm' })}>
        <span style={s({ fontSize: '22pt', fontWeight: 'bold', letterSpacing: '0.15em' })}>御 見 積 書</span>
      </div>

      {/* ヘッダー：左右2カラム */}
      <div style={s({ display: 'flex', gap: '6mm', marginBottom: '3mm' })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s({ marginBottom: '2mm' })}>
            <span style={s({
              fontSize: '14pt', fontWeight: 'bold',
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
            <span style={s({ whiteSpace: 'nowrap', marginRight: '2mm', fontSize: '9.5pt' })}>件　名：</span>
            <span style={s({ fontSize: titleFontSize(displayTitle), fontWeight: 'bold', lineHeight: '1.5', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' })}>
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
        </div>

        <div style={{ width: '68mm', flexShrink: 0 }}>
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
        </div>
      </div>

      {/* 消費税テキスト（左）＋サイン（右） */}
      {(() => {
        const showApprover = approverProfile && approverProfile.id !== creatorProfile?.id
        return (
          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: '0' }}>
            <div style={{ flex: 1 }}>
              {!isTaxIncl && (
                <div style={s({ fontSize: '8.5pt', fontWeight: 'bold' })}>
                  ※ 本御見積には消費税は含まれておりません。
                </div>
              )}
            </div>
            <div style={s({ fontSize: '7.5pt', color: '#444', lineHeight: '1.5' })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2mm' }}>
                <span style={{ whiteSpace: 'nowrap' }}>Prepared by:</span>
                {creatorProfile?.signature_url ? (
                  <img src={creatorProfile.signature_url} alt="担当サイン"
                    style={{ height: '9mm', maxWidth: '25mm', objectFit: 'contain', opacity: 0.9 }} />
                ) : (
                  <span style={{ color: '#555' }}>{creatorProfile?.name || ''}</span>
                )}
              </div>
              {showApprover && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2mm' }}>
                  <span style={{ whiteSpace: 'nowrap' }}>Approver:</span>
                  {approverProfile?.signature_url ? (
                    <img src={approverProfile.signature_url} alt="承認者サイン"
                      style={{ height: '9mm', maxWidth: '25mm', objectFit: 'contain', opacity: 0.9 }} />
                  ) : (
                    <span style={{ color: '#555' }}>{approverProfile?.name || ''}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

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
          {catGroups.flatMap((cat, ci) => {
            const showCat = !!(cat.name?.trim())
            const doPageBreak = showCat && ci > 0 && effectivePageBreaks.has(cat.name)
            const catSubtotal = cat.items.reduce((acc, i) => acc + Number(i.amount), 0)
            const rows = []

            // カテゴリヘッダー行（改ページ指定がある場合は break-before を付与）
            if (showCat) {
              rows.push(
                <tr key={`cat-${ci}`} style={{
                  ...(doPageBreak ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}),
                  height: '8mm',
                }}>
                  <td colSpan={5} style={s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', fontSize: '8.5pt', verticalAlign: 'middle' })}>
                    ■{cat.name}
                  </td>
                </tr>
              )
            }

            // アイテム行
            cat.items.forEach(item => {
              rows.push(
                <tr key={item.id} style={{ height: '8mm' }}>
                  <td style={s({ border: '1px solid #999', padding: '0.5mm 2.5mm', maxWidth: 0, overflow: 'hidden', verticalAlign: 'middle' })}>
                    <div style={s({ fontSize: itemFontSize(item.name), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.25' })}>
                      {item.name}
                    </div>
                    {item.spec && (
                      <div style={s({ fontSize: '7pt', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.25' })}>
                        {item.spec}
                      </div>
                    )}
                  </td>
                  <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'right', verticalAlign: 'middle' })}>
                    {Number(item.quantity).toLocaleString()}
                  </td>
                  <td style={s({ border: '1px solid #999', padding: '0 1mm', textAlign: 'center', verticalAlign: 'middle' })}>{item.unit}</td>
                  <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(item.unit_price)}</td>
                  <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle' })}>{fmt(item.amount)}</td>
                </tr>
              )
            })

            // 小計行・空白行
            if (showCat) {
              rows.push(
                <tr key={`sub-${ci}`} style={{ height: '8mm' }}>
                  <td style={s({ border: '1px solid #999', padding: '0 2.5mm', fontWeight: 'bold', verticalAlign: 'middle' })}>【小計】</td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', fontWeight: 'bold', verticalAlign: 'middle' })}>{fmt(catSubtotal)}</td>
                </tr>
              )
              rows.push(
                <tr key={`sp-${ci}`} style={{ height: '8mm' }}>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                  <td style={s({ border: '1px solid #999' })}></td>
                </tr>
              )
            }

            return rows
          })}

          {/* 値引き（最後の小計の下に表示） */}
          {discount !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', verticalAlign: 'middle' })}>御値引き</td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999' })}></td>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', textAlign: 'right', verticalAlign: 'middle', color: '#c00' })}>-{fmt(discount)}</td>
            </tr>
          )}

          {/* 法定福利費 */}
          {welfareCost !== 0 && (
            <tr style={{ height: '8mm' }}>
              <td style={s({ border: '1px solid #999', padding: '0 2.5mm', verticalAlign: 'middle' })}>法定福利費</td>
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
