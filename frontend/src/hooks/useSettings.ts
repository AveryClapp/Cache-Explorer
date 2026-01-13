import { useState, useEffect, useCallback } from 'react'
import type { Theme, PrefetchPolicy, CustomCacheConfig, DefineEntry } from '../types'

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'

export const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 256,
  l2Assoc: 8,
  l3Size: 8192,
  l3Assoc: 16,
}

export interface UseSettingsReturn {
  // Theme
  theme: Theme
  toggleTheme: () => void

  // Cache config
  config: string
  setConfig: (config: string) => void
  customConfig: CustomCacheConfig
  setCustomConfig: (config: CustomCacheConfig) => void

  // Compiler settings
  optLevel: string
  setOptLevel: (level: string) => void
  selectedCompiler: string
  setSelectedCompiler: (compiler: string) => void

  // Prefetch
  prefetchPolicy: PrefetchPolicy
  setPrefetchPolicy: (policy: PrefetchPolicy) => void

  // Sampling & limits
  sampleRate: number
  setSampleRate: (rate: number) => void
  eventLimit: number
  setEventLimit: (limit: number) => void
  fastMode: boolean
  setFastMode: (fast: boolean) => void

  // Preprocessor defines
  defines: DefineEntry[]
  setDefines: (defines: DefineEntry[]) => void
}

export function useSettings(): UseSettingsReturn {
  // Theme with localStorage persistence
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cache-explorer-theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'dark'
  })

  // Cache configuration
  const [config, setConfig] = useState('educational')
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)

  // Compiler settings
  const [optLevel, setOptLevel] = useState('-O0')
  const [selectedCompiler, setSelectedCompiler] = useState<string>('')

  // Prefetch
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')

  // Sampling & limits
  const [sampleRate, setSampleRate] = useState(1)
  const [fastMode, setFastMode] = useState(false)
  const [eventLimit, setEventLimit] = useState(100000)

  // Preprocessor defines
  const [defines, setDefines] = useState<DefineEntry[]>([])

  // Sync theme to document and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  // Auto-adjust event limit based on optimization level
  useEffect(() => {
    const limits: Record<string, number> = {
      '-O0': 100000,
      '-O1': 200000,
      '-O2': 500000,
      '-O3': 500000,
      '-Os': 500000,
      '-Oz': 500000,
    }
    setEventLimit(limits[optLevel] || 100000)
  }, [optLevel])

  // Fetch default compiler on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.default) {
          setSelectedCompiler(data.default)
        } else if (data.compilers && data.compilers.length > 0) {
          setSelectedCompiler(data.compilers[0].id)
        }
      })
      .catch(err => {
        console.warn('Failed to fetch compilers:', err)
      })
  }, [])

  return {
    theme,
    toggleTheme,
    config,
    setConfig,
    customConfig,
    setCustomConfig,
    optLevel,
    setOptLevel,
    selectedCompiler,
    setSelectedCompiler,
    prefetchPolicy,
    setPrefetchPolicy,
    sampleRate,
    setSampleRate,
    eventLimit,
    setEventLimit,
    fastMode,
    setFastMode,
    defines,
    setDefines,
  }
}
