import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Pencil, Trash2, Building2, Upload } from 'lucide-react'

const empty = {
  name: '', display_name: '', name_en: '', tagline: '',
  postal_code: '', address: '', address_en: '', address_en2: '',
  phone: '', fax: '', email: '', website: '', bank_info: '', license_number: '',
  logo_url: '', stamp_url: '', terms_en: '', pos1: 10, pos2: 8, pos3: 0, pos4: 0,
  office_options: []
}

export default function CompanyManagement() {
  const { isAdmin } = useAuth()
  const [companies, setCompanies] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingStamp, setUploadingStamp] = useState(false)
  const [newOfficeInput, setNewOfficeInput] = useState('')
  const logoRef = useRef()
  const stampRef = useRef()

  useEffect(() => { fetchCompanies() }, [])

  async function fetchCompanies() {
    const { data } = await supabase.from('companies').select('*').order('name')
    setCompanies(data || [])
  }

  function openCreate() { setForm(empty); setNewOfficeInput(''); setModal('create') }
  function openEdit(c) { setForm({ ...empty, ...c, office_options: c.office_options || [] }); setNewOfficeInput(''); setModal('edit') }

  // File を Canvas で 長辺400px PNG に圧縮（透過保持）
  async function compressImageFile(file, maxSize = 400) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = ev => {
        const img = new Image()
        img.onload = () => {
          try {
            let { width, height } = img
            if (width > maxSize || height > maxSize) {
              if (width >= height) {
                height = Math.round(height * (maxSize / width))
                width = maxSize
              } else {
                width = Math.round(width * (maxSize / height))
                height = maxSize
              }
            }
            const canvas = document.createElement('canvas')
            canvas.width = width; canvas.height = height
            canvas.getContext('2d').drawImage(img, 0, 0, width, height)
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob fail')), 'image/png')
          } catch (e) { reject(e) }
        }
        img.onerror = reject
        img.src = ev.target.result
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function uploadImage(file, type) {
    const setter = type === 'logo' ? setUploadingLogo : setUploadingStamp
    setter(true)
    try {
      // 圧縮（長辺400px PNG）
      let blob = file
      try { blob = await compressImageFile(file, 400) } catch (e) { /* 圧縮失敗時は元ファイルを使用 */ }
      const path = `${type}_${Date.now()}.png`
      const { error } = await supabase.storage.from('company-assets').upload(path, blob, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: '0',
      })
      if (error) { alert('アップロードに失敗しました'); return }
      const { data } = supabase.storage.from('company-assets').getPublicUrl(path)
      const field = type === 'logo' ? 'logo_url' : 'stamp_url'
      // キャッシュバスター付与
      setForm(f => ({ ...f, [field]: `${data.publicUrl}?v=${Date.now()}` }))
    } finally {
      setter(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const data = { ...form, pos1: Number(form.pos1), pos2: Number(form.pos2), pos3: Number(form.pos3), pos4: Number(form.pos4) }
    const { error } = modal === 'edit'
      ? await supabase.from('companies').update(data).eq('id', form.id)
      : await supabase.from('companies').insert(data)
    setSaving(false)
    if (error) { alert(`保存に失敗しました:\n${error.message}`); return }
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
        <div className="flex flex-col gap-4">
          {companies.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex gap-4 items-stretch">
                {/* EN preview */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <p className="text-xs font-semibold text-blue-500 mb-2 uppercase tracking-wide">English ver</p>
                  <EnPreviewCard company={c} />
                </div>
                <div className="w-px bg-gray-100" />
                {/* JP preview */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">日本語 ver</p>
                  <JpPreviewCard company={c} />
                </div>
              </div>
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
          <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl mx-4 max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-800">{modal === 'edit' ? '発行会社編集' : '発行会社登録'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* 左列：English ver */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 border-r border-gray-100">
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">English ver</p>

                {[
                  ['name_en', 'Company Name'],
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Office Names</label>
                  <p className="text-xs text-gray-400 mb-2">ユーザー管理でサインの下に表示するオフィス名の選択肢を登録します。</p>
                  <div className="space-y-1.5 mb-2">
                    {(form.office_options || []).map((name, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="flex-1 text-sm border border-gray-200 rounded px-3 py-1 bg-gray-50">{name}</span>
                        <button
                          onClick={() => setForm(f => ({ ...f, office_options: f.office_options.filter((_, idx) => idx !== i) }))}
                          className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newOfficeInput}
                      onChange={e => setNewOfficeInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newOfficeInput.trim()) {
                          setForm(f => ({ ...f, office_options: [...(f.office_options || []), newOfficeInput.trim()] }))
                          setNewOfficeInput('')
                        }
                      }}
                      placeholder="例: Tokyo Office"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => {
                        if (newOfficeInput.trim()) {
                          setForm(f => ({ ...f, office_options: [...(f.office_options || []), newOfficeInput.trim()] }))
                          setNewOfficeInput('')
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50">
                      <Plus size={13} /> 追加
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tagline</label>
                  <textarea
                    value={form.tagline || ''}
                    onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {[
                  ['address_en', 'Address1'],
                  ['address_en2', 'Address2'],
                  ['phone', 'TEL'],
                  ['website', 'Web Site'],
                  ['license_number', 'License'],
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Logo</label>
                  <input type="file" accept="image/*" ref={stampRef} className="hidden"
                    onChange={e => e.target.files[0] && uploadImage(e.target.files[0], 'stamp')} />
                  <button
                    onClick={() => stampRef.current.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-blue-400 transition-colors"
                  >
                    {form.stamp_url ? (
                      <img src={form.stamp_url} alt="ロゴ（English）" className="h-12 object-contain mx-auto" />
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

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-gray-600">Logo Size</label>
                    <span className="text-xs text-gray-400">{form.pos3 || 10}</span>
                  </div>
                  <input
                    type="range" min="4" max="30" value={form.pos3 || 10}
                    onChange={e => setForm(f => ({ ...f, pos3: Number(e.target.value), pos4: Number(e.target.value) }))}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-gray-300 mt-0.5">
                    <span>小</span><span>大</span>
                  </div>
                </div>
              </div>

              {/* 右列：日本語 ver */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">日本語 ver</p>

                {[
                  ['name', '会社名 *'],
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">タグライン（挨拶文）</label>
                  <textarea
                    value={form.display_name || ''}
                    onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                    rows={3}
                    placeholder="毎度御引立て賜り、誠に有難う御座います。&#10;下記の通り御見積申しあげます。"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {[
                  ['postal_code', '郵便番号'],
                  ['address', '住所'],
                  ['phone', 'TEL'],
                  ['fax', 'FAX'],
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
                  <label className="block text-xs font-medium text-gray-600 mb-1">ロゴ画像（日本語）</label>
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
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-gray-600">ロゴサイズ（日本語）</label>
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

function EnPreviewCard({ company }) {
  const stampSize = Number(company.pos3 || 10) * 8
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs h-[100px] overflow-hidden">
      <div className="flex items-center gap-2 h-full">
        {company.stamp_url && (
          <img src={company.stamp_url} alt="logo" className="object-contain flex-shrink-0"
            style={{ width: `${stampSize}px`, maxWidth: `${stampSize}px`, maxHeight: '76px' }} />
        )}
        <div>
          <p className="font-bold text-gray-900">{company.name_en || '—'}</p>
          {company.address_en && <p className="text-gray-500">{company.address_en}</p>}
          {company.address_en2 && <p className="text-gray-500">{company.address_en2}</p>}
          {company.phone && <p className="text-gray-500">T: {company.phone}</p>}
          {company.website && <p className="text-gray-500">{company.website}</p>}
        </div>
      </div>
    </div>
  )
}

function JpPreviewCard({ company }) {
  const logoSize = Number(company.pos1 || 10) * 4
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs h-[100px] overflow-hidden">
      <div className="flex items-center gap-2 h-full">
        {company.logo_url && (
          <img src={company.logo_url} alt="ロゴ" className="object-contain flex-shrink-0"
            style={{ width: `${logoSize}px`, maxWidth: `${logoSize}px`, maxHeight: '76px' }} />
        )}
        <div>
          <p className="font-bold text-gray-900">{company.name || '—'}</p>
          {company.postal_code && <p className="text-gray-500">〒{company.postal_code}</p>}
          {company.address && <p className="text-gray-500">{company.address}</p>}
          {company.phone && <p className="text-gray-500">TEL {company.phone}</p>}
          {company.fax && <p className="text-gray-500">FAX {company.fax}</p>}
        </div>
      </div>
    </div>
  )
}
