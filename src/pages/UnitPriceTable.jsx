import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Pencil, Trash2, Upload, Download, ArrowLeft, List, GripVertical } from 'lucide-react'
import { useDragAutoScroll } from '../hooks/useDragAutoScroll'

// Numbersを含む一般的なCSVパーサー（クォート・改行・BOM対応）
function parseCSV(text) {
  // BOM除去
  const raw = text.replace(/^\uFEFF/, '')
  const rows = []
  let i = 0
  const len = raw.length

  function parseField() {
    if (raw[i] === '"') {
      i++ // 開きクォートをスキップ
      let field = ''
      while (i < len) {
        if (raw[i] === '"' && raw[i + 1] === '"') {
          field += '"'; i += 2
        } else if (raw[i] === '"') {
          i++; break
        } else {
          field += raw[i++]
        }
      }
      return field
    }
    let field = ''
    while (i < len && raw[i] !== ',' && raw[i] !== '\n' && raw[i] !== '\r') {
      field += raw[i++]
    }
    return field.trim()
  }

  while (i < len) {
    const row = []
    while (i < len && raw[i] !== '\n' && raw[i] !== '\r') {
      row.push(parseField())
      if (raw[i] === ',') i++
    }
    if (raw[i] === '\r') i++
    if (raw[i] === '\n') i++
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row)
  }

  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).map(vals =>
    Object.fromEntries(headers.map((h, idx) => [h, vals[idx] ?? '']))
  )
}

const CATEGORY_COLORS = {
  '材料費': 'bg-blue-50 text-blue-700',
  '労務費': 'bg-green-50 text-green-700',
  '共通費': 'bg-orange-50 text-orange-700',
}

const emptyItem = { name: '', spec: '', unit: '式', price: 0, buy_price: 0, category: '材料費', notes: '' }

export default function UnitPriceTable() {
  const { profile, isAdmin } = useAuth()
  useDragAutoScroll()
  const [tables, setTables] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [items, setItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('全体')
  const [modal, setModal] = useState(null) // 'addTable' | 'renameTable' | 'addItem' | 'editItem'
  const [form, setForm] = useState(emptyItem)
  const [newTableName, setNewTableName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renameTarget, setRenameTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [recentUsageMap, setRecentUsageMap] = useState({})
  const csvRef = useRef()
  const stickyRef = useRef()

  useEffect(() => { fetchTables() }, [])

  async function fetchTables() {
    const { data } = await supabase.from('unit_price_tables').select('*').order('sort_order', { nullsFirst: false }).order('created_at')
    setTables(data || [])
  }

  async function fetchItems(tableId) {
    const { data } = await supabase
      .from('unit_prices')
      .select('*')
      .eq('table_id', tableId)
      .order('sort_order', { nullsFirst: false })
      .order('category')
      .order('name')
    const list = data || []
    setItems(list)
    fetchRecentUsage(list)
  }

  async function fetchRecentUsage(itemList) {
    if (!itemList || itemList.length === 0) { setRecentUsageMap({}); return }
    const ids = itemList.map(i => i.id).filter(Boolean)
    if (!ids.length) { setRecentUsageMap({}); return }
    const { data } = await supabase
      .from('quotation_items')
      .select('unit_price_id, unit_price, purchase_unit_price, quotation_id, quotations(id, quotation_number, created_at)')
      .in('unit_price_id', ids)
      .not('unit_price_id', 'is', null)
    if (!data) { setRecentUsageMap({}); return }
    // 見積作成日時の降順でソートし、unit_price_id ごとに最新1件を取得
    const sorted = [...data].sort((a, b) => {
      const da = a.quotations?.created_at || ''
      const db = b.quotations?.created_at || ''
      return db.localeCompare(da)
    })
    const map = {}
    sorted.forEach(item => {
      if (item.unit_price_id && !map[item.unit_price_id]) {
        map[item.unit_price_id] = item
      }
    })
    setRecentUsageMap(map)
  }

  // ── 単価表一覧 ドラッグ＆ドロップ ──
  const [dragTableId,     setDragTableId]     = useState(null)
  const [dragTableOverId, setDragTableOverId] = useState(null)

  async function handleTableDrop(targetId) {
    if (!dragTableId || dragTableId === targetId) return
    const arr = [...tables]
    const fromIdx = arr.findIndex(t => t.id === dragTableId)
    const toIdx   = arr.findIndex(t => t.id === targetId)
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
    const newArr = arr.map((t, i) => ({ ...t, sort_order: (i + 1) * 10 }))
    setTables(newArr)
    setDragTableId(null)
    setDragTableOverId(null)
    await Promise.all(newArr.map(t =>
      supabase.from('unit_price_tables').update({ sort_order: t.sort_order }).eq('id', t.id)
    ))
  }

  // ── 単価アイテム ドラッグ＆ドロップ（同カテゴリ内のみ）──
  const [dragItemId,     setDragItemId]     = useState(null)
  const [dragItemOverId, setDragItemOverId] = useState(null)

  async function handleItemDrop(targetItem) {
    if (!dragItemId || dragItemId === targetItem.id) return
    const draggedItem = items.find(i => i.id === dragItemId)
    // 異なるカテゴリへのドロップは無視
    if (!draggedItem || draggedItem.category !== targetItem.category) {
      setDragItemId(null); setDragItemOverId(null); return
    }
    const catItems = items
      .filter(i => i.category === draggedItem.category)
      .sort((a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999))
    const fromIdx = catItems.findIndex(i => i.id === dragItemId)
    const toIdx   = catItems.findIndex(i => i.id === targetItem.id)
    const newCat  = [...catItems]
    const [moved] = newCat.splice(fromIdx, 1)
    newCat.splice(toIdx, 0, moved)
    const newCatWithOrder = newCat.map((it, i) => ({ ...it, sort_order: (i + 1) * 10 }))
    setItems(prev => {
      const map = new Map(newCatWithOrder.map(it => [it.id, it]))
      const updated = prev.map(it => map.get(it.id) || it)
      return [...updated].sort((a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999))
    })
    setDragItemId(null)
    setDragItemOverId(null)
    await Promise.all(newCatWithOrder.map(it =>
      supabase.from('unit_prices').update({ sort_order: it.sort_order }).eq('id', it.id)
    ))
  }

  function selectTable(t) {
    setSelectedTable(t)
    setActiveCategory('全体')
    setSearch('')
    fetchItems(t.id)
  }

  function backToList() {
    setSelectedTable(null)
    setItems([])
    setActiveCategory('全体')
  }

  // カテゴリ一覧（固定順: 全体→材料費→労務費→共通費→その他）
  const CATEGORY_ORDER = ['材料費', '労務費', '共通費']
  const otherCats = [...new Set(items.map(i => i.category).filter(Boolean))].filter(c => !CATEGORY_ORDER.includes(c))
  const uniqueCategories = ['全体', ...CATEGORY_ORDER.filter(c => items.some(i => i.category === c)), ...otherCats]

  // フィルタリング
  const filtered = items.filter(i => {
    const matchCat = activeCategory === '全体' || i.category === activeCategory
    if (i.spec === '__header__') return matchCat && !search
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.spec || '').toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  // 利益率計算
  function profitRate(sellPrice, buyPrice) {
    const s = Number(sellPrice), b = Number(buyPrice)
    if (!s) return '―'
    return ((s - b) / s * 100).toFixed(1)
  }

  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP') }
  function fmtDate(d) { return d ? new Date(d).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-') : '' }

  // 単価表作成
  async function handleCreateTable() {
    if (!newTableName.trim()) return
    setSaving(true)
    const { data } = await supabase.from('unit_price_tables').insert({ name: newTableName, created_by: profile.id }).select().single()
    setSaving(false)
    setNewTableName('')
    setModal(null)
    await fetchTables()
    if (data) selectTable(data)
  }

  // 単価表リネーム
  async function handleRenameTable() {
    if (!renameValue.trim() || !renameTarget) return
    setSaving(true)
    await supabase.from('unit_price_tables').update({ name: renameValue.trim() }).eq('id', renameTarget.id)
    setSaving(false)
    const newName = renameValue.trim()
    setRenameValue('')
    setRenameTarget(null)
    setModal(null)
    await fetchTables()
    if (selectedTable?.id === renameTarget.id) setSelectedTable(t => ({ ...t, name: newName }))
  }

  // 単価表削除
  async function handleDeleteTable(t) {
    if (!confirm(`「${t.name}」を削除しますか？\n含まれる単価データもすべて削除されます。`)) return
    await supabase.from('unit_price_tables').delete().eq('id', t.id)
    fetchTables()
  }

  // アイテム保存
  async function handleSaveItem() {
    setSaving(true)
    let sort_order = form.sort_order
    if (modal !== 'editItem') {
      const catItems = items.filter(i => i.category === form.category)
      const minOrder = catItems.length > 0 ? Math.min(...catItems.map(i => i.sort_order ?? 999999)) : 10
      sort_order = Math.max(1, minOrder - 10)
    }
    const data = { ...form, sort_order, price: Number(form.price), buy_price: Number(form.buy_price), table_id: selectedTable.id, created_by: profile.id, notes: form.notes ? form.notes.slice(0, 100) : null }
    if (modal === 'editItem') {
      await supabase.from('unit_prices').update(data).eq('id', form.id)
    } else {
      await supabase.from('unit_prices').insert(data)
    }
    setSaving(false)
    setModal(null)
    fetchItems(selectedTable.id)
  }

  // アイテム削除
  async function handleDeleteItem(id) {
    if (!confirm('この単価を削除しますか？')) return
    await supabase.from('unit_prices').delete().eq('id', id)
    fetchItems(selectedTable.id)
  }

  // CSVエスケープ（カンマ・改行・ダブルクォートを含む場合はクォートで囲む）
  function csvEscape(val) {
    const s = val == null ? '' : String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  // 現在の単価表をCSVエクスポート（Numbers/Excel対応・UTF-8 BOM付き）
  function downloadCSV() {
    const header = ['名称', '仕様', '単位', '見積単価', '仕入単価', 'カテゴリ', '備考']
    // items は sort_order 順に並んでいるのでそのまま使用
    const rows = items.map(item => [
      item.name,
      item.spec || '',
      item.unit,
      item.price,
      item.buy_price,
      item.category || '',
      item.notes || '',
    ])
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n') + '\r\n'
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const safeName = (selectedTable?.name || 'unit_price').replace(/[\\/:*?"<>|]/g, '_')
    a.download = `${safeName}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // CSV取り込み
  async function handleCSVImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const text = await file.text()
    const rows = parseCSV(text)
    if (!rows.length) { alert('データがありません'); return }

    const toInsert = rows
      .filter(r => r['名称'])
      .map(r => ({
        table_id: selectedTable.id,
        name: r['名称'] || '',
        spec: r['仕様'] || null,
        unit: r['単位'] || '式',
        price: Number(r['見積単価']) || 0,
        buy_price: Number(r['仕入単価']) || 0,
        category: r['カテゴリ'] || '材料費',
        notes: r['備考'] ? r['備考'].slice(0, 100) : null,
        created_by: profile.id,
      }))

    if (!toInsert.length) { alert('有効なデータがありません'); return }
    const { error } = await supabase.from('unit_prices').insert(toInsert)
    if (error) { alert('取り込みエラー: ' + error.message); return }
    alert(`${toInsert.length}件を取り込みました`)
    fetchItems(selectedTable.id)
    e.target.value = ''
  }

  // ========================
  // 単価表一覧画面
  // ========================
  if (!selectedTable) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-800">登録単価表</h1>
          <button onClick={() => setModal('addTable')}
            className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={16} /> 新規作成
          </button>
        </div>

        {tables.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
            <List size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">単価表がありません</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-xl mx-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-700 text-white">
                  {isAdmin && <th className="w-8"></th>}
                  <th className="px-4 py-3 text-left text-sm font-medium">名前</th>
                  <th className="px-4 py-3 text-center text-sm font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tables.map((t) => (
                  <tr
                    key={t.id}
                    draggable={isAdmin}
                    onDragStart={() => isAdmin && setDragTableId(t.id)}
                    onDragEnd={() => { setDragTableId(null); setDragTableOverId(null) }}
                    onDragOver={e => { e.preventDefault(); isAdmin && setDragTableOverId(t.id) }}
                    onDrop={() => isAdmin && handleTableDrop(t.id)}
                    className={`hover:bg-gray-50 cursor-pointer transition-colors
                      ${dragTableId === t.id ? 'opacity-40' : ''}
                      ${dragTableOverId === t.id && dragTableId !== t.id ? 'border-t-2 border-blue-500' : ''}
                    `}
                    onClick={() => selectTable(t)}
                  >
                    {isAdmin && (
                      <td className="pl-2 pr-0 py-3 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                        <GripVertical size={16} className="text-gray-400 mx-auto" />
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-800">{t.name}</td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-2">
                        {isAdmin && (
                          <button onClick={() => { setRenameTarget(t); setRenameValue(t.name); setModal('renameTable') }}
                            className="text-gray-400 hover:text-blue-600" title="名前を変更">
                            <Pencil size={15} />
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={() => handleDeleteTable(t)} className="text-gray-400 hover:text-red-600" title="削除">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 新規単価表モーダル */}
        {modal === 'addTable' && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
              <h3 className="font-semibold text-gray-800 mb-4">単価表を作成</h3>
              <input value={newTableName} onChange={e => setNewTableName(e.target.value)}
                placeholder="単価表名（例：10X標準価格）"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
                <button onClick={handleCreateTable} disabled={saving || !newTableName.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '作成中...' : '作成'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* リネームモーダル */}
        {modal === 'renameTable' && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-sm mx-4 p-6">
              <h3 className="font-semibold text-gray-800 mb-4">名前を変更</h3>
              <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                placeholder="新しい単価表名"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setModal(null); setRenameTarget(null); setRenameValue('') }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
                <button onClick={handleRenameTable} disabled={saving || !renameValue.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ========================
  // 単価表詳細画面
  // ========================
  return (
    <div>
      {/* 固定ヘッダーエリア */}
      <div ref={stickyRef} className="sticky top-14 z-20 bg-gray-50 -mx-6 px-6 pb-2 border-b border-gray-200">
        {/* タイトル行 */}
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <button onClick={backToList} className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></button>
            <h1 className="text-xl font-semibold text-gray-800">{selectedTable.name}</h1>
            {isAdmin && (
              <button
                onClick={() => { setRenameTarget(selectedTable); setRenameValue(selectedTable.name); setModal('renameTable') }}
                className="text-gray-400 hover:text-blue-600 ml-1" title="名前を変更">
                <Pencil size={16} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadCSV} disabled={items.length === 0}
              className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              title="現在の単価表をCSVでダウンロード">
              <Download size={15} /> CSVエクスポート
            </button>
            <input type="file" accept=".csv" ref={csvRef} className="hidden" onChange={handleCSVImport} />
            <button onClick={() => csvRef.current.click()}
              className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">
              <Upload size={15} /> CSV取り込み
            </button>
            <button onClick={() => { setForm({ name: '', spec: '__header__', unit: '', price: 0, buy_price: 0, category: activeCategory !== '全体' ? activeCategory : '材料費', notes: '' }); setModal('addItem') }}
              className="flex items-center gap-1.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100">
              <Plus size={15} /> 見出し
            </button>
            <button onClick={() => { setForm(emptyItem); setModal('addItem') }}
              className="flex items-center gap-1.5 text-sm text-white bg-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-700">
              <Plus size={15} /> 追加
            </button>
          </div>
        </div>

        {/* カテゴリタブ */}
        <div className="flex gap-1 border-b border-gray-200">
          {uniqueCategories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeCategory === cat
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {cat}
            </button>
          ))}
        </div>

        {/* 見出しジャンプタブ */}
        {!search && (() => {
          const headerItems = items.filter(i =>
            i.spec === '__header__' && (activeCategory === '全体' || i.category === activeCategory)
          )
          if (headerItems.length === 0) return null
          return (
            <div className="flex gap-1.5 flex-wrap items-center px-1 pt-2">
              <span className="text-xs text-gray-400">見出し：</span>
              {headerItems.map(h => (
                <button key={h.id}
                  onClick={() => {
                  const el = document.getElementById(`header-${h.id}`)
                  if (!el) return
                  const offset = 56 + (stickyRef.current?.offsetHeight || 0) + 8
                  const y = el.getBoundingClientRect().top + window.scrollY - offset
                  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
                }}
                  className="px-2.5 py-0.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full hover:bg-amber-100 transition-colors flex items-center gap-1">
                  【{h.name}】
                  {activeCategory === '全体' && (
                    <span className="text-[10px] text-amber-500">{h.category}</span>
                  )}
                </button>
              ))}
            </div>
          )
        })()}

        {/* 検索 */}
        <div className="pt-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="品名・仕様で検索"
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* テーブル */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-blue-700 text-white">
              {isAdmin && !search && <th className="w-8"></th>}
              <th className="px-4 py-3 text-left text-xs font-medium">名称</th>
              <th className="px-4 py-3 text-left text-xs font-medium">仕様</th>
              <th className="px-4 py-3 text-center text-xs font-medium w-16">単位</th>
              <th className="px-4 py-3 text-right text-xs font-medium w-24">見積単価</th>
              <th className="px-4 py-3 text-right text-xs font-medium w-24">仕入単価</th>
              <th className="px-4 py-3 text-right text-xs font-medium w-16">利益率</th>
              <th className="px-4 py-3 text-left text-xs font-medium w-36">最終更新日時</th>
              <th className="px-4 py-3 text-center text-xs font-medium w-16">操作</th>
              <th className="px-4 py-3 text-left text-xs font-medium w-52">直近実績</th>
            </tr>
          </thead>
          <tbody>
            {/* カテゴリごとにグループ表示 */}
            {(() => {
              const groups = {}
              filtered.forEach(item => {
                const cat = item.category || '未分類'
                if (!groups[cat]) groups[cat] = []
                groups[cat].push(item)
              })
              const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
                const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b)
                if (ia >= 0 && ib >= 0) return ia - ib
                if (ia >= 0) return -1
                if (ib >= 0) return 1
                return 0
              })
              return sortedGroups.map(([cat, catItems]) => {
                const allCatItems = items
                  .filter(i => i.category === cat)
                  .sort((a, b) => (a.sort_order ?? 999999) - (b.sort_order ?? 999999))
                return (
                  <>
                    {activeCategory === '全体' && (
                      <tr key={`cat-${cat}`} className="bg-gray-300">
                        <td colSpan={isAdmin && !search ? 10 : 9} className="px-3 py-2 text-sm font-semibold text-gray-800">{cat}</td>
                      </tr>
                    )}
                    {catItems.map((item, i) => {
                      const isItemDragging = dragItemId === item.id
                      const isItemOver     = dragItemOverId === item.id && dragItemId !== item.id
                      const isHeader       = item.spec === '__header__'

                      if (isHeader) {
                        return (
                          <tr
                            id={`header-${item.id}`}
                            key={item.id}
                            draggable={isAdmin && !search}
                            onDragStart={() => isAdmin && !search && setDragItemId(item.id)}
                            onDragEnd={() => { setDragItemId(null); setDragItemOverId(null) }}
                            onDragOver={e => { e.preventDefault(); isAdmin && !search && setDragItemOverId(item.id) }}
                            onDrop={() => isAdmin && !search && handleItemDrop(item)}
                            className={`bg-amber-50 ${isItemDragging ? 'opacity-40' : ''} ${isItemOver ? 'border-t-2 border-blue-500' : ''}`}
                          >
                            {isAdmin && !search && (
                              <td className="pl-2 pr-0 py-1.5 cursor-grab active:cursor-grabbing">
                                <GripVertical size={15} className="text-gray-400 mx-auto" />
                              </td>
                            )}
                            <td colSpan={7} className="px-4 py-1.5 font-bold text-amber-800 text-sm">
                              【{item.name}】
                            </td>
                            <td className="px-4 py-1.5 text-center">
                              {isAdmin && (
                                <div className="flex justify-center gap-1">
                                  <button onClick={() => { setForm(item); setModal('editItem') }}
                                    className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                                  <button onClick={() => handleDeleteItem(item.id)}
                                    className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                                </div>
                              )}
                            </td>
                            <td></td>
                          </tr>
                        )
                      }

                      return (
                        <tr
                          key={item.id}
                          draggable={isAdmin && !search}
                          onDragStart={() => isAdmin && !search && setDragItemId(item.id)}
                          onDragEnd={() => { setDragItemId(null); setDragItemOverId(null) }}
                          onDragOver={e => { e.preventDefault(); isAdmin && !search && setDragItemOverId(item.id) }}
                          onDrop={() => isAdmin && !search && handleItemDrop(item)}
                          className={`transition-colors
                            ${i % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50'}
                            ${isItemDragging ? 'opacity-40' : ''}
                            ${isItemOver ? 'border-t-2 border-blue-500' : ''}
                          `}
                        >
                          {isAdmin && !search && (
                            <td className="pl-2 pr-0 py-2.5 cursor-grab active:cursor-grabbing">
                              <GripVertical size={15} className="text-gray-400 mx-auto" />
                            </td>
                          )}
                          <td className="px-4 py-2.5 text-gray-800">{item.name}</td>
                          <td className="px-4 py-2.5 text-gray-500 text-xs">{item.spec || ''}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{item.unit}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-800">{fmt(item.price)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{fmt(item.buy_price)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{profitRate(item.price, item.buy_price)}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{fmtDate(item.updated_at || item.created_at)}</td>
                          <td className="px-4 py-2.5 text-center">
                            <div className="flex justify-center gap-1">
                              <button onClick={() => { setForm(item); setModal('editItem') }}
                                className="text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
                              {isAdmin && (
                                <button onClick={() => handleDeleteItem(item.id)}
                                  className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {(() => {
                              const usage = recentUsageMap[item.id]
                              if (!usage) return <span className="text-gray-300 text-xs">―</span>
                              return (
                                <div className="text-xs leading-relaxed">
                                  <Link
                                    to={`/quotations/${usage.quotation_id}/edit`}
                                    className="text-blue-600 hover:underline font-medium"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    {usage.quotations?.quotation_number || '―'}
                                  </Link>
                                  <div className="text-gray-400">{fmtDate(usage.quotations?.created_at)}</div>
                                  <div className="text-gray-600">
                                    見積 ¥{fmt(usage.unit_price)} / 仕入 ¥{fmt(usage.purchase_unit_price)}
                                  </div>
                                </div>
                              )
                            })()}
                          </td>
                        </tr>
                      )
                    })}
                  </>
                )
              })
            })()}
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin && !search ? 10 : 9} className="text-center py-10 text-gray-400 text-sm">データがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 追加・編集モーダル */}
      {(modal === 'addItem' || modal === 'editItem') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
            {(() => {
              const isHeaderForm = form.spec === '__header__'
              const modalTitle = isHeaderForm
                ? (modal === 'editItem' ? '見出しを編集' : '見出しを追加')
                : (modal === 'editItem' ? '単価編集' : '単価追加')
              return (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-800">{modalTitle}</h3>
                    <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
                      <select value={form.category || '材料費'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option>材料費</option>
                        <option>労務費</option>
                        <option>共通費</option>
                        <option>その他</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{isHeaderForm ? '見出し名 *' : '品名 *'}</label>
                      <input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={isHeaderForm ? '例：セキュリティ' : ''} />
                    </div>
                    {!isHeaderForm && (
                      <>
                        {[['spec', '仕様/型番'], ['unit', '単位']].map(([key, label]) => (
                          <div key={key}>
                            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                            <input value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                        ))}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">見積単価</label>
                            <input type="number" value={form.price} min="0"
                              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">仕入単価</label>
                            <input type="number" value={form.buy_price} min="0"
                              onChange={e => setForm(f => ({ ...f, buy_price: e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                        </div>
                        {Number(form.price) > 0 && (
                          <p className="text-xs text-gray-500">利益率：{profitRate(form.price, form.buy_price)}%</p>
                        )}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            備考 <span className="text-gray-400 font-normal">（最大100文字・一覧には表示されません）</span>
                          </label>
                          <textarea
                            value={form.notes || ''}
                            onChange={e => setForm(f => ({ ...f, notes: e.target.value.slice(0, 100) }))}
                            maxLength={100}
                            rows={2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            placeholder="補足情報など"
                          />
                          <p className="text-xs text-gray-400 text-right mt-0.5">{(form.notes || '').length}/100</p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex gap-3 justify-end mt-4">
                    <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
                    <button onClick={handleSaveItem} disabled={saving || !form.name}
                      className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
