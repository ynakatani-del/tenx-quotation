import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Pencil, Trash2, Building2, Upload } from 'lucide-react'

const empty = {
  name: '', display_name: '', postal_code: '', address: '', phone: '', fax: '',
  email: '', website: '', bank_info: '', license_number: '',
  logo_url: '', stamp_url: '', pos1: 10, pos2: 8, pos3: 0, pos4: 0
}

export default function CompanyManagement() {
  const { isAdmin } = useAuth()
  const [companies, setCompanies] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingStamp, setUploadingStamp] = useState(false)
  const logoRef = useRef()
  const stampRef = useRef()

  useEffect(() => { fetchCompanies() }, [])

  async function fetchCompanies() {
    const { data } = await supabase.from('companies').select('*').order('name')
    setCompanies(data || [])
  }

  function openCreate() { setForm(empty); setModal('create') }
  function openEdit(c) { setForm(c); setModal('edit') }

  async function uploadImage(file, type) {
    const setter = type === 'logo' ? setUploadingLogo : setUploadingStamp
    setter(true)
    const ext = file.name.split('.').pop()
    const path = `${type}_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('company-assets').upload(path, file, { upsert: true })
    setter(false)
    if (error) { alert('アップロードに失敗しました'); return }
    const { data } = supabase.storage.from('company-assets').getPublicUrl(path)
    const field = type === 'logo' ? 'logo_url' : 'stamp_url'
    setForm(f => ({ ...f, [field]: data.publicUrl }))
  }

  async function handleSave() {
    setSaving(true)
    const data = { ...form, pos1: Number(form.pos1), pos2: Number(form.pos2), pos3: Number(form.pos3), pos4: Number(form.pos4) }
    if (modal === 'edit') {
      await supabase.from('companies').update(data).eq('id', form.id)
    } else {
      await supabase.from('companies').insert(data)
    }
    setSaving(false)
    setModal(null)
    fetchCompanies()
  }

  async function handleDelete(id) {
    if (!confirm('この発行会社を削除しますか？')) return
    await supabase.from('companies').delete().eq('id', id)
    fetchCompanies()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-800">発行会社管理</h1>
        {isAdmin && (
          <button onClick={openCreate} className="flex items-center gap-2 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={16} /> 新規登録
          </button>
        )}
      </div>

      {companies.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">発行会社が登録されていません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
              {/* プレビューカード */}
              <CompanyPreviewCard company={c} />
              {isAdmin && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button onClick={() => openEdit(c)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600">
                    <Pencil size={13} /> 編集
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 ml-auto">
                    <Trash2 size={13} /> 削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl mx-4 max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-800">{modal === 'edit' ? '発行会社編集' : '発行会社登録'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* 入力フォーム */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {[
                  ['display_name', '名称'],
                  ['name', '発行会社名 *'],
                  ['postal_code', '郵便番号'],
                  ['address', '住所'],
                  ['phone', '電話番号'],
                  ['fax', 'FAX'],
                  ['email', 'メール'],
                  ['website', 'ウェブサイト'],
                  ['license_number', '建設業許可番号'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      value={form[key] || ''}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">振込先情報</label>
                  <textarea
                    value={form.bank_info || ''}
                    onChange={e => setForm(f => ({ ...f, bank_info: e.target.value }))}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* ロゴ・印鑑アップロード */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ロゴ画像</label>
                    <input type="file" accept="image/*" ref={logoRef} className="hidden"
                      onChange={e => e.target.files[0] && uploadImage(e.target.files[0], 'logo')} />
                    <button
                      onClick={() => logoRef.current.click()}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 transition-colors"
                    >
                      {form.logo_url ? (
                        <img src={form.logo_url} alt="ロゴ" className="h-12 object-contain mx-auto" />
                      ) : (
                        <div className="text-gray-400">
                          {uploadingLogo ? <span className="text-xs">アップロード中...</span> : (
                            <><Upload size={20} className="mx-auto mb-1" /><span className="text-xs">クリックして選択</span></>
                          )}
                        </div>
                      )}
                    </button>
                    {form.logo_url && (
                      <button onClick={() => setForm(f => ({ ...f, logo_url: '' }))}
                        className="text-xs text-red-400 mt-1 hover:text-red-600">削除</button>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">印鑑画像</label>
                    <input type="file" accept="image/*" ref={stampRef} className="hidden"
                      onChange={e => e.target.files[0] && uploadImage(e.target.files[0], 'stamp')} />
                    <button
                      onClick={() => stampRef.current.click()}
                      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 transition-colors"
                    >
                      {form.stamp_url ? (
                        <img src={form.stamp_url} alt="印鑑" className="h-12 object-contain mx-auto" />
                      ) : (
                        <div className="text-gray-400">
                          {uploadingStamp ? <span className="text-xs">アップロード中...</span> : (
                            <><Upload size={20} className="mx-auto mb-1" /><span className="text-xs">クリックして選択</span></>
                          )}
                        </div>
                      )}
                    </button>
                    {form.stamp_url && (
                      <button onClick={() => setForm(f => ({ ...f, stamp_url: '' }))}
                        className="text-xs text-red-400 mt-1 hover:text-red-600">削除</button>
                    )}
                  </div>
                </div>

                {/* サイズ調整 */}
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-gray-600">ロゴサイズ</label>
                      <span className="text-xs text-gray-400">{form.pos1}</span>
                    </div>
                    <input
                      type="range" min="4" max="30" value={form.pos1}
                      onChange={e => setForm(f => ({ ...f, pos1: Number(e.target.value), pos2: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                    <div className="flex justify-between text-xs text-gray-300 mt-0.5">
                      <span>小</span><span>大</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-medium text-gray-600">印鑑サイズ</label>
                      <span className="text-xs text-gray-400">{form.pos3 || 13}</span>
                    </div>
                    <input
                      type="range" min="4" max="30" value={form.pos3 || 13}
                      onChange={e => setForm(f => ({ ...f, pos3: Number(e.target.value), pos4: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                    <div className="flex justify-between text-xs text-gray-300 mt-0.5">
                      <span>小</span><span>大</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* プレビュー */}
              <div className="md:w-72 p-4 border-t md:border-t-0 md:border-l border-gray-100 bg-gray-50">
                <p className="text-xs font-medium text-gray-500 mb-3">プレビュー</p>
                <CompanyPreviewCard company={form} />
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

function CompanyPreviewCard({ company }) {
  const logoSize = Number(company.pos1 || 10) * 4
  const stampSize = Number(company.pos3 || 13) * 4

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs overflow-hidden">
      {/* 印鑑を絶対配置して住所に重ねる・ロゴは折り返しなし */}
      <div className="relative">
        <div className="flex items-start gap-2" style={{ flexWrap: 'nowrap' }}>
          {/* ロゴ：固定幅・縮まない */}
          {company.logo_url && (
            <img
              src={company.logo_url}
              alt="ロゴ"
              className="object-contain flex-shrink-0"
              style={{ width: `${logoSize}px`, height: `${logoSize}px`, minWidth: `${logoSize}px` }}
            />
          )}
          {/* テキスト：右端は印鑑サイズ分あける */}
          <div style={{ paddingRight: company.stamp_url ? `${stampSize + 4}px` : '0' }}>
            <p className="font-bold text-gray-900 text-sm">{company.name || '会社名'}</p>
            {company.postal_code && <p className="text-gray-500">〒{company.postal_code}</p>}
            {company.address && <p className="text-gray-500">{company.address}</p>}
            {company.phone && <p className="text-gray-500">TEL {company.phone}</p>}
            {company.fax && <p className="text-gray-500">FAX {company.fax}</p>}
          </div>
        </div>
        {/* 印鑑：絶対配置で右上に重ねる */}
        {company.stamp_url && (
          <img
            src={company.stamp_url}
            alt="印鑑"
            className="object-contain opacity-80"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: `${stampSize}px`,
              height: `${stampSize}px`,
            }}
          />
        )}
      </div>
    </div>
  )
}
