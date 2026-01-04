import { useState, useEffect, useCallback } from 'react'
import type { Theme } from '../types'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cache-explorer-theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'dark'
  })

  // Sync theme to DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, setTheme: setThemeState, toggleTheme }
}
