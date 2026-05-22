import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react'

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const DEFAULT_MANAGED = {
  '現場管理費': { rate: 15, base_cats: ['材料費', '労務費'] },
  '一般管理費': { rate: 10, base_cats: ['材料費', '労務費'] },
  '安全対策費': { rate: 3,  base_cats: ['労務費'] },
  '諸経費':     { rate: 3,  base_cats: ['材料費', '労務費', '共通費'] },
}

export default function Settings() {
  const { profile } = useAuth()
  const [taxRate, setTaxRate] = useState(10)
  const [fiscalStart, setFiscalStart] = useState(12)
  const [zaizaiRate, setZaizaiRate] = useState(10)
  const [welfareRate, setWelfareRate] = useState(16)
  const [discountRate, setDiscountRate] = useState(0)
  const [managedDefaults, setManagedDefaults] = useState(DEFAULT_MANAGED)
  const [termsDefault, setTermsDefault] = useState('')
  const [deliveryDefault, setDeliveryDefault] = useState('別途御打合せ')
  const [paymentDefault, setPaymentDefault] = useState('従来通り')
  const [validityDefault, setValidityDefault] = useState('発行後90日')
  const [officeOptions, setOfficeOptions] = useState([])
  const [newOfficeName, setNewOfficeName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('settings').select('tax_rate, fiscal_month_start, expense_defaults').single().then(({ data }) => {
      if (data) {
        setTaxRate(Number(data.tax_rate))
        setFiscalStart(Number(data.fiscal_month_start || 12))
        if (data.expense_defaults) {
          try {
            const def = JSON.parse(data.expense_defaults)
            if (def.zaizai_rate !== undefined) setZaizaiRate(Number(def.zaizai_rate))
            if (def.welfare_rate !== undefined) setWelfareRate(Number(def.welfare_rate))
            if (def.discount_rate !== undefined) setDiscountRate(Number(def.discount_rate))
            if (def.managed) setManagedDefaults(prev => ({ ...prev, ...def.managed }))
            if (def.terms_default !== undefined) setTermsDefault(def.terms_default)
            if (def.delivery_default !== undefined) setDeliveryDefault(def.delivery_default)
            if (def.payment_default !== undefined) setPaymentDefault(def.payment_default)
            if (def.validity_default !== undefined) setValidityDefault(def.validity_default)
            if (def.office_options) setOfficeOptions(def.office_options)
          } catch {}
        }
      }
    })
  }, [])

  function setManagedRate(name, val) {
    setManagedDefaults(prev => ({ ...prev, [name]: { ...prev[name], rate: Number(val) } }))
  }

  function toggleManagedBaseCat(name, cat) {
    setManagedDefaults(prev => {
      const cur = prev[name].base_cats || []
      const updated = cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat]
      return { ...prev, [name]: { ...prev[name], base_cats: updated } }
    })
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    await supabase.from('settings').update({
      tax_rate: taxRate,
      fiscal_month_start: fiscalStart,
      expense_defaults: JSON.stringify({ zaizai_rate: zaizaiRate, welfare_rate: welfareRate, discount_rate: discountRate, managed: managedDefaults, terms_default: termsDefault, delivery_default: deliveryDefault, payment_default: paymentDefault, validity_default: validityDefault, office_options: officeOptions }),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    setSaving(false)
    setMsg('設定を更新しました')
    setTimeout(() => setMsg(''), 3000)
  }

  const fiscalEndMonth = fiscalStart === 1 ? 12 : fiscalStart - 1

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">設定</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <SettingsIcon size={20} className="text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-700">システム設定（特権管理者のみ）</h2>
        </div>

        {/* 消費税率 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">消費税率</h3>
          <p className="text-xs text-gray-400 mb-3">新規作成する見積書に適用されます。既存の見積書には影響しません。</p>
          <div className="flex items-center gap-3">
            <input type="number" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))}
              min="0" max="100" step="0.1"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-sm text-gray-500">%</span>
          </div>
        </section>

        {/* 決算開始月 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">決算期 開始月</h3>
          <p className="text-xs text-gray-400 mb-3">集計画面の「今期」ボタンの基準になります。</p>
          <select value={fiscalStart} onChange={e => setFiscalStart(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {MONTH_NAMES.map((label, i) => (
              <option key={i + 1} value={i + 1}>{label}始まり</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-2">
            現在の設定：{MONTH_NAMES[fiscalStart - 1]}〜{MONTH_NAMES[fiscalEndMonth - 1]}
          </p>
        </section>

        {/* 雑材消耗品 デフォルト率 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">雑材消耗品 デフォルト率</h3>
          <p className="text-xs text-gray-400 mb-3">新規見積書作成時に材料費カテゴリへ自動追加される雑材消耗品のデフォルト率です。</p>
          <div className="flex items-center gap-3">
            <input type="number" value={zaizaiRate} onChange={e => setZaizaiRate(Number(e.target.value))}
              min="0" max="100" step="1"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-sm text-gray-500">%（材料費計に対する割合）</span>
          </div>
        </section>

        {/* 法定福利費 デフォルト率 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">法定福利費 デフォルト率</h3>
          <p className="text-xs text-gray-400 mb-3">新規見積書作成時に適用される法定福利費の計算率です。労務費合計に対する割合で自動計算されます。</p>
          <div className="flex items-center gap-3">
            <input type="number" value={welfareRate} onChange={e => setWelfareRate(Number(e.target.value))}
              min="0" max="100" step="0.1"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-sm text-gray-500">%（労務費合計に対する割合）</span>
          </div>
        </section>

        {/* 値引き デフォルト率 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">値引き デフォルト率</h3>
          <p className="text-xs text-gray-400 mb-3">新規見積書作成時に適用される値引きのデフォルト率です。小計に対する割合で自動計算されます。</p>
          <div className="flex items-center gap-3">
            <input type="number" value={discountRate} onChange={e => setDiscountRate(Number(e.target.value))}
              min="0" max="100" step="0.1"
              className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span className="text-sm text-gray-500">%（小計に対する割合）</span>
          </div>
        </section>

        {/* 管理費 デフォルト設定 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">共通費 管理費 デフォルト設定</h3>
          <p className="text-xs text-gray-400 mb-4">新規見積書作成時に適用されるデフォルト値です。各管理費の計算基礎と率を設定してください。</p>
          <div className="space-y-4">
            {Object.entries(managedDefaults).map(([name, def]) => (
              <div key={name} className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                <div className="flex items-center gap-4 mb-3">
                  <span className="text-sm font-medium text-indigo-800 w-28">{name}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" value={def.rate} onChange={e => setManagedRate(name, e.target.value)}
                      min="0" max="100" step="1"
                      className="w-20 border border-indigo-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                    <span className="text-sm text-indigo-600">%</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-indigo-500">計算対象：</span>
                  {['材料費', '労務費', '共通費'].map(cat => (
                    <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                      <input type="checkbox"
                        checked={(def.base_cats || []).includes(cat)}
                        onChange={() => toggleManagedBaseCat(name, cat)}
                        className="accent-indigo-600 w-4 h-4" />
                      <span className="text-indigo-700">{cat}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Terms & Conditions デフォルト */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Terms & Conditions デフォルト文</h3>
          <p className="text-xs text-gray-400 mb-3">見積書PDFの注記欄に表示されるデフォルト文です。空欄の場合はシステム既定文を使用します。</p>
          <textarea
            value={termsDefault}
            onChange={e => setTermsDefault(e.target.value)}
            rows={5}
            placeholder={"01.  Any additional work will be performed on a T&M basis.\n02.  PO & payment shall be processed in JPY."}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </section>

        {/* 納期・支払条件・見積有効期間 デフォルト */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">納期・支払条件・見積有効期間 デフォルト</h3>
          <p className="text-xs text-gray-400 mb-3">新規見積書作成時に適用されるデフォルト値です。</p>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-28 shrink-0">納期</label>
              <input type="text" value={deliveryDefault} onChange={e => setDeliveryDefault(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-28 shrink-0">支払条件</label>
              <input type="text" value={paymentDefault} onChange={e => setPaymentDefault(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-28 shrink-0">見積有効期間</label>
              <input type="text" value={validityDefault} onChange={e => setValidityDefault(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </section>

        {/* オフィスオプション管理 */}
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">オフィス名 登録</h3>
          <p className="text-xs text-gray-400 mb-3">ユーザー管理でサインの下に表示するオフィス名の選択肢を登録します。</p>
          <div className="space-y-2 mb-3">
            {officeOptions.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 bg-gray-50">{name}</span>
                <button onClick={() => setOfficeOptions(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newOfficeName}
              onChange={e => setNewOfficeName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newOfficeName.trim()) { setOfficeOptions(prev => [...prev, newOfficeName.trim()]); setNewOfficeName('') } }}
              placeholder="例: Tokyo Office"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => { if (newOfficeName.trim()) { setOfficeOptions(prev => [...prev, newOfficeName.trim()]); setNewOfficeName('') } }}
              className="flex items-center gap-1 px-3 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50">
              <Plus size={14} /> 追加
            </button>
          </div>
        </section>

        <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
          {msg && <p className="text-sm text-green-600">{msg}</p>}
        </div>
      </div>
    </div>
  )
}
