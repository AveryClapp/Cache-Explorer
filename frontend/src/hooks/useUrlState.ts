import { useEffect } from 'react'
import { decodeState } from '../utils/state'
import { API_BASE } from '../constants/config'
import type { ShareableState, Language, DefineEntry, PrefetchPolicy } from '../types'

export function useUrlState(
  onLoadState: (state: ShareableState) => void,
  deps: [string, string, string, Language, DefineEntry[], PrefetchPolicy?, string?, number?, number?, boolean?, boolean?]
) {
  void deps

  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      if (shortId) {
        try {
          const response = await fetch(`${API_BASE}/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            onLoadState(data.state)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          onLoadState(saved)
        }
      }
    }
    loadState()
  }, [onLoadState])

}

export async function shareUrl(state: ShareableState): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    })
    const data = await response.json()
    if (data.id) {
      return `${window.location.origin}${window.location.pathname}?s=${data.id}`
    }
  } catch { /* sharing requires the server so source is never copied into the URL */ }
  return null
}
