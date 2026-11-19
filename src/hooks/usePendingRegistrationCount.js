import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function usePendingRegistrationCount(enabled) {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const { count: pendingCount, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    if (!error) setCount(pendingCount || 0)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined

    const initialTimer = window.setTimeout(refresh, 0)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('tenx:registration-count-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const timer = window.setInterval(refresh, 60_000)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('tenx:registration-count-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [enabled, refresh])

  return {
    pendingRegistrationCount: enabled ? count : 0,
    refreshPendingRegistrationCount: refresh,
  }
}
