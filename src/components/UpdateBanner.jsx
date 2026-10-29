/* global __BUILD_ID__ */
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

// 現在読み込まれているビルドの版番号（vite.config の define で埋め込まれる）
const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

// 新しいデプロイがあると画面上部に「再読み込み」の帯を出す。
// タブを開きっぱなしでも、タブに戻った時／定期的に /version.json を確認して検知する。
export default function UpdateBanner() {
  const [newBuild, setNewBuild] = useState(null)
  const dismissedRef = useRef(null) // 「後で」を押した版番号は再表示しない

  useEffect(() => {
    // 開発中は不要
    if (import.meta.env.DEV) return

    let stopped = false

    async function check() {
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const latest = data?.build
        if (stopped || !latest) return
        if (latest !== CURRENT_BUILD && latest !== dismissedRef.current) {
          setNewBuild(latest)
        }
      } catch {
        // ネットワーク断などは無視（次回のチェックで再試行）
      }
    }

    // 初回＋定期（60秒）＋タブに戻った時
    check()
    const timer = setInterval(check, 60_000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  if (!newBuild) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-blue-600 text-white shadow-md">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-sm">
        <RefreshCw size={16} className="shrink-0" />
        <span>新しいバージョンがあります。最新の機能・修正を反映するには再読み込みしてください。</span>
        <button
          onClick={() => window.location.reload()}
          className="shrink-0 bg-white text-blue-700 font-medium rounded-md px-3 py-1 hover:bg-blue-50"
        >
          再読み込み
        </button>
        <button
          onClick={() => { dismissedRef.current = newBuild; setNewBuild(null) }}
          className="shrink-0 text-white/80 hover:text-white"
          title="後で"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
