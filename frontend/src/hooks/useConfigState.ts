import { useState, useEffect, useCallback } from 'react'
import type { Compiler, CustomCacheConfig, PrefetchPolicy, DefineEntry } from '../types'
import { PREFETCH_DEFAULTS, defaultCustomConfig, API_BASE } from '../constants/config'

export function useConfigState() {
  const [config, setConfigState] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')
  const [compilers, setCompilers] = useState<Compiler[]>([])
  const [selectedCompiler, setSelectedCompiler] = useState<string>('')
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [sampleRate, setSampleRate] = useState(1)
  const [eventLimit, setEventLimit] = useState(5000000)

  // Fetch compilers on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.compilers && data.compilers.length > 0) {
          setCompilers(data.compilers)
          setSelectedCompiler(data.default || data.compilers[0].id)
        }
      })
      .catch(err => {
        console.warn('Failed to fetch compilers:', err)
      })
  }, [])

  const setConfig = useCallback((newConfig: string) => {
    setConfigState(newConfig)
    setPrefetchPolicy(PREFETCH_DEFAULTS[newConfig] || 'none')
  }, [])

  return {
    config,
    optLevel,
    prefetchPolicy,
    compilers,
    selectedCompiler,
    customConfig,
    defines,
    sampleRate,
    eventLimit,
    setConfig,
    setOptLevel,
    setPrefetchPolicy,
    setSelectedCompiler,
    setCustomConfig,
    setDefines,
    setSampleRate,
    setEventLimit
  }
}
