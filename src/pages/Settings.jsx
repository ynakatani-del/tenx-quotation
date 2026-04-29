import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Settings as SettingsIcon } from 'lucide-react'

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
      expense_defaults: JSON.stringify({ zaizai_rate: zaizaiRate, welfare_rate: welfareRate, discount_rate: discountRate, managed: managedDefaults }),
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
