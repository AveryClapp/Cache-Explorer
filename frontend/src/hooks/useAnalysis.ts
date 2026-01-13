import { useState, useRef, useCallback } from 'react'
import type {
  CacheResult,
  ErrorResult,
  Stage,
  FileTab,
  CustomCacheConfig,
  DefineEntry,
  PrefetchPolicy
} from '../types'

// API configuration
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

export interface AnalysisConfig {
  config: string
  optLevel: string
  customConfig?: CustomCacheConfig
  defines?: DefineEntry[]
  prefetchPolicy?: PrefetchPolicy
  sampleRate?: number
  eventLimit?: number
  selectedCompiler?: string
  fastMode?: boolean
}

export interface UseAnalysisReturn {
  // State
  result: CacheResult | null
  error: ErrorResult | null
  stage: Stage
  isLoading: boolean
  longRunning: boolean
  stageText: string

  // Actions
  runAnalysis: (files: FileTab[], config: AnalysisConfig) => void
  cancelAnalysis: () => void
  clearResults: () => void

  // Export
  exportAsJSON: () => void
  exportAsCSV: () => void
}

export function useAnalysis(): UseAnalysisReturn {
  const [result, setResult] = useState<CacheResult | null>(null)
  const [error, setError] = useState<ErrorResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [longRunning, setLongRunning] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const longRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelAnalysis = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (longRunTimeoutRef.current) {
      clearTimeout(longRunTimeoutRef.current)
      longRunTimeoutRef.current = null
    }
    setStage('idle')
    setLongRunning(false)
  }, [])

  const clearResults = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  const runAnalysis = useCallback((files: FileTab[], analysisConfig: AnalysisConfig) => {
    const {
      config,
      optLevel,
      customConfig,
      defines = [],
      prefetchPolicy = 'none',
      sampleRate = 1,
      eventLimit = 0,
      selectedCompiler,
      fastMode = false
    } = analysisConfig

    // Input validation
    const totalSize = files.reduce((sum, f) => sum + f.code.length, 0)
    if (totalSize > 100000) {
      setError({ type: 'validation_error', message: 'Code too long (max 100KB total)', suggestion: 'Try smaller programs or use sampling' })
      return
    }
    if (files.every(f => f.code.trim().length === 0)) {
      setError({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    // Cancel any ongoing analysis
    cancelAnalysis()

    setStage('connecting')
    setError(null)
    setResult(null)
    setLongRunning(false)

    // Set long-running warning after 10 seconds
    longRunTimeoutRef.current = setTimeout(() => setLongRunning(true), 10000)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    const buildPayload = (): Record<string, unknown> => {
      const payload: Record<string, unknown> = { config, optLevel }

      if (files.length === 1) {
        payload.code = files[0].code
        payload.language = files[0].language
      } else {
        payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
        payload.language = files[0].language
      }

      if (config === 'custom' && customConfig) payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
      if (sampleRate > 1) payload.sample = sampleRate
      if (eventLimit > 0) payload.limit = eventLimit
      if (selectedCompiler) payload.compiler = selectedCompiler
      if (fastMode) payload.fast = true

      return payload
    }

    ws.onopen = () => {
      ws.send(JSON.stringify(buildPayload()))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') {
        setStage(msg.stage as Stage)
      } else if (msg.type === 'result') {
        if (longRunTimeoutRef.current) clearTimeout(longRunTimeoutRef.current)
        setLongRunning(false)
        setResult(msg.data as CacheResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        if (longRunTimeoutRef.current) clearTimeout(longRunTimeoutRef.current)
        setLongRunning(false)
        setError(msg as ErrorResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      }
    }

    const fallbackToHttp = async () => {
      wsRef.current = null
      setStage('compiling')

      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
          signal: controller.signal,
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        abortControllerRef.current = null
        if (longRunTimeoutRef.current) clearTimeout(longRunTimeoutRef.current)
        setLongRunning(false)
        setStage('idle')
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => {
      if (!e.wasClean && stage !== 'idle') fallbackToHttp()
    }
  }, [cancelAnalysis, stage])

  const exportAsJSON = useCallback(() => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cache-analysis-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  const exportAsCSV = useCallback(() => {
    if (!result) return
    const lines: string[] = ['Metric,Value']
    const l1 = result.levels.l1d || result.levels.l1
    if (l1) {
      lines.push(`L1 Hits,${l1.hits}`)
      lines.push(`L1 Misses,${l1.misses}`)
      lines.push(`L1 Hit Rate,${(l1.hitRate * 100).toFixed(2)}%`)
    }
    if (result.levels.l2) {
      lines.push(`L2 Hits,${result.levels.l2.hits}`)
      lines.push(`L2 Misses,${result.levels.l2.misses}`)
      lines.push(`L2 Hit Rate,${(result.levels.l2.hitRate * 100).toFixed(2)}%`)
    }
    if (result.levels.l3) {
      lines.push(`L3 Hits,${result.levels.l3.hits}`)
      lines.push(`L3 Misses,${result.levels.l3.misses}`)
      lines.push(`L3 Hit Rate,${(result.levels.l3.hitRate * 100).toFixed(2)}%`)
    }
    if (result.timing) {
      lines.push(`Total Cycles,${result.timing.totalCycles}`)
      lines.push(`Avg Latency,${result.timing.avgLatency.toFixed(2)}`)
    }
    lines.push(`Total Events,${result.events}`)

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cache-analysis-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [result])

  const isLoading = stage !== 'idle'
  const stageTextMap: Record<Stage, string> = {
    idle: '',
    connecting: 'Connecting...',
    preparing: 'Preparing...',
    compiling: 'Compiling...',
    running: 'Running...',
    processing: 'Processing...',
    done: ''
  }

  return {
    result,
    error,
    stage,
    isLoading,
    longRunning,
    stageText: stageTextMap[stage],
    runAnalysis,
    cancelAnalysis,
    clearResults,
    exportAsJSON,
    exportAsCSV,
  }
}
