import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Settings as SettingsIcon } from 'lucide-react'

const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export default function Settings() {
  const { profile } = useAuth()
  const [taxRate, setTaxRate] = useState(10)
  const [fiscalStart, setFiscalStart] = useState(12)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('settings').select('tax_rate, fiscal_month_start').single().then(({ data }) => {
      if (data) {
        setTaxRate(Number(data.tax_rate))
        setFiscalStart(Number(data.fiscal_month_start || 12))
      }
    })
  }, [])

  async function handleSave() {
    setSaving(true)
    setMsg('')
    await supabase
      .from('settings')
      .update({
        tax_rate: taxRate,
        fiscal_month_start: fiscalStart,
        updated_by: profile.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
    setSaving(false)
    setMsg('設定を更新しました')
    setTimeout(() => setMsg(''), 3000)
  }

  const fiscalEndMonth = fiscalStart === 1 ? 12 : fiscalStart - 1

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold text-gray-800 mb-6">システム設定</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <SettingsIcon size={20} className="text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-700">設定（特権管理者のみ）</h2>
        </div>

        {/* 消費税率 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">消費税率（%）</label>
          <p className="text-xs text-gray-400 mb-2">新規作成する見積書に適用されます。既存の見積書には影響しません。</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={taxRate}
              onChange={e => setTaxRate(Number(e.target.value))}
              min="0"
              max="100"
              step="0.1"
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500">%</span>
          </div>
        </div>

        {/* 決算開始月 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">決算期 開始月</label>
          <p className="text-xs text-gray-400 mb-2">集計画面の「今期」ボタンの基準になります。</p>
          <div className="flex items-center gap-3">
            <select
              value={fiscalStart}
              onChange={e => setFiscalStart(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTH_NAMES.map((label, i) => (
                <option key={i + 1} value={i + 1}>{label}始まり</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            現在の設定：{MONTH_NAMES[fiscalStart - 1]}〜{MONTH_NAMES[fiscalEndMonth - 1]}
          </p>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {msg && <p className="text-sm text-green-600">{msg}</p>}
        </div>
      </div>
    </div>
  )
}
