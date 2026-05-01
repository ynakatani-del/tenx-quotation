import { useEffect } from 'react'

/**
 * ドラッグ中に画面端に近づくと自動スクロールするフック
 * @param {Object} options
 * @param {number} options.edgeSize  - 端からこのpx以内でスクロール開始（デフォルト: 80）
 * @param {number} options.maxSpeed - 最大スクロール速度 px/event（デフォルト: 18）
 */
export function useDragAutoScroll({ edgeSize = 100, maxSpeed = 40 } = {}) {
  useEffect(() => {
    let rafId = null

    function onDragOver(e) {
      const y = e.clientY
      const h = window.innerHeight

      // 前フレームのRAFをキャンセル
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }

      if (y < edgeSize) {
        // 上端スクロール：端に近いほど速い
        const intensity = (edgeSize - y) / edgeSize
        const scrollAmount = -Math.ceil(maxSpeed * intensity)
        rafId = requestAnimationFrame(() => {
          window.scrollBy(0, scrollAmount)
          rafId = null
        })
      } else if (y > h - edgeSize) {
        // 下端スクロール：端に近いほど速い
        const intensity = (y - (h - edgeSize)) / edgeSize
        const scrollAmount = Math.ceil(maxSpeed * intensity)
        rafId = requestAnimationFrame(() => {
          window.scrollBy(0, scrollAmount)
          rafId = null
        })
      }
    }

    function onDragEnd() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragend', onDragEnd)
    document.addEventListener('drop', onDragEnd)

    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragend', onDragEnd)
      document.removeEventListener('drop', onDragEnd)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])
}
