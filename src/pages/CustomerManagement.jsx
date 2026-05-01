import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Pencil, Trash2, Users, GripVertical } from 'lucide-react'
import { useDragAutoScroll } from '../hooks/useDragAutoScroll'

const empty = { name: '', name_en: '', postal_code: '', address: '', address_en: '', phone: '', fax: '', email: '', contact_person: '', department: '', notes: '' }

export default function CustomerManagement() {
  const { isAdmin } = useAuth()
  const [customers, setCustomers] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  useDragAutoScroll()

  useEffect(() => { fetch() }, [])

  async function fetch() {
    const { data } = await supabase.from('customers').select('*').order('sort_order', { nullsFirst: false }).order('name')
    setCustomers(data || [])
  }

  const [dragCustId, setDragCustId] = useState(null)
  const [dragCustOverId, setDragCustOverId] = useState(null)

  async function handleCustomerDrop(targetId) {
    if (!dragCustId || dragCustId === targetId) return
    const arr = [...customers]
    const fromIdx = arr.findIndex(c => c.id === dragCustId)
    const toIdx   = arr.findIndex(c => c.id === targetId)
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)
    const newArr = arr.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }))
    setCustomers(newArr)
    setDragCustId(null)
    setDragCustOverId(null)
    await Promise.all(newArr.map(c =>
      supabase.from('customers').update({ sort_order: c.sort_order }).eq('id', c.id)
    ))
  }

  function openCreate() { setForm(empty); setModal('create') }
  function openEdit(c) { setForm(c); setModal('edit') }

  async function handleSave() {
    setSaving(true)
    if (modal === 'edit') {
      await supabase.from('customers').update(form).eq('id', form.id)
    } else {
      await supabase.from('customers').insert(form)
    }
    setSaving(false)
    setModal(null)
    fetch()
  }

  async function handleDelete(id) {
    if (!confirm('この顧客を削除しますか？')) return
    await supabase.from('customers').delete().eq('id', id)
    fetch()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-800">顧客管理</h1>
        {isAdmin && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={16} /> 新規登録
          </button>
        )}
      </div>

      {customers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">顧客が登録されていません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {isAdmin && <th className="w-8"></th>}
                <th className="px-4 py-3 text-left text-xs text-gray-500">会社名</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500">担当者</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500">電話</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500">メール</th>
                <th className="px-4 py-3 text-left text-xs text-gray-500">住所</th>
                {isAdmin && <th className="px-4 py-3 text-center text-xs text-gray-500">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  draggable={isAdmin}
                  onDragStart={() => isAdmin && setDragCustId(c.id)}
                  onDragEnd={() => { setDragCustId(null); setDragCustOverId(null) }}
                  onDragOver={e => { e.preventDefault(); isAdmin && setDragCustOverId(c.id) }}
                  onDrop={() => isAdmin && handleCustomerDrop(c.id)}
                  className={`transition-colors hover:bg-gray-50
                    ${dragCustId === c.id ? 'opacity-40' : ''}
                    ${dragCustOverId === c.id && dragCustId !== c.id ? 'border-t-2 border-blue-500' : ''}
                  `}
                >
                  {isAdmin && (
                    <td className="pl-2 pr-0 py-3 cursor-grab active:cursor-grabbing">
                      <GripVertical size={16} className="text-gray-400 mx-auto" />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.contact_person || '―'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone || '―'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email || '―'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{c.address || '―'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-blue-600"><Pencil size={15} /></button>
                        <button onClick={() => handleDelete(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-800">{modal === 'edit' ? '顧客編集' : '顧客登録'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {[
                ['name', '会社名 * (日本語)', 'text'],
                ['name_en', '会社名 (English)', 'text'],
                ['contact_person', '担当者名', 'text'],
                ['department', '部署', 'text'],
                ['postal_code', '郵便番号', 'text'],
                ['address', '住所 (日本語)', 'text'],
                ['address_en', '住所 (English)', 'text'],
                ['phone', '電話番号', 'text'],
                ['fax', 'FAX', 'text'],
                ['email', 'メール', 'email'],
              ].map(([key, label, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key] || ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">備考</label>
                <textarea
                  value={form.notes || ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end p-4 border-t">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">キャンセル</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
