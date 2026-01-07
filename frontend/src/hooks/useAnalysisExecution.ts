import { useCallback, useRef } from 'react'
import type { FileTab, Stage, CacheResult, ErrorResult, DefineEntry, CustomCacheConfig } from '../types'

// Constants from config
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

interface UseAnalysisExecutionParams {
  files: FileTab[]
  mainFileId: string
  config: string
  optLevel: string
  prefetchPolicy: string
  customConfig: CustomCacheConfig
  defines: DefineEntry[]
  sampleRate: number
  eventLimit: number
  selectedCompiler: string
  longRunning: boolean
  onStageChange: (stage: Stage) => void
  onResultChange: (result: CacheResult | null) => void
  onErrorChange: (error: ErrorResult | null) => void
  onLongRunningChange: (value: boolean) => void
}

export function useAnalysisExecution(params: UseAnalysisExecutionParams) {
  const wsRef = useRef<WebSocket | null>(null)
  const stageRef = useRef<Stage>('idle')

  const runAnalysis = useCallback(() => {
    // Input validation - check total size across all files
    const totalSize = params.files.reduce((sum: number, f: FileTab) => sum + f.code.length, 0)
    if (totalSize > 100000) {
      params.onErrorChange({ type: 'validation_error', message: 'Code too long (max 100KB total)', suggestion: 'Try smaller programs or use sampling' })
      return
    }
    if (params.files.every((f: FileTab) => f.code.trim().length === 0)) {
      params.onErrorChange({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    stageRef.current = 'connecting'
    params.onStageChange('connecting')
    params.onErrorChange(null)
    params.onResultChange(null)
    params.onLongRunningChange(false)

    // Set long-running warning after 10 seconds
    const longRunTimeout = setTimeout(() => params.onLongRunningChange(true), 10000)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      const payload: Record<string, unknown> = { config: params.config, optLevel: params.optLevel }
      // Send files array for multi-file support, single code for backward compatibility
      if (params.files.length === 1) {
        payload.code = params.files[0].code
        payload.language = params.files[0].language
      } else {
        payload.files = params.files.map(f => ({ name: f.name, code: f.code, language: f.language }))
        payload.language = params.files[0].language // Primary language for compilation
      }
      if (params.config === 'custom') payload.customConfig = params.customConfig
      if (params.defines.length > 0) payload.defines = params.defines.filter(d => d.name.trim())
      if (params.prefetchPolicy !== 'none') payload.prefetch = params.prefetchPolicy
      if (params.sampleRate > 1) payload.sample = params.sampleRate
      if (params.eventLimit > 0) payload.limit = params.eventLimit
      if (params.selectedCompiler) payload.compiler = params.selectedCompiler
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') {
        stageRef.current = msg.stage as Stage
        params.onStageChange(msg.stage as Stage)
      } else if (msg.type === 'result') {
        clearTimeout(longRunTimeout)
        params.onLongRunningChange(false)
        params.onResultChange(msg.data as CacheResult)
        stageRef.current = 'idle'
        params.onStageChange('idle')
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        // Handle all error types: 'error', 'compile_error', 'linker_error', etc.
        clearTimeout(longRunTimeout)
        params.onLongRunningChange(false)
        params.onErrorChange(msg as ErrorResult)
        stageRef.current = 'idle'
        params.onStageChange('idle')
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stageRef.current !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      stageRef.current = 'compiling'
      params.onStageChange('compiling')
      try {
        const payload: Record<string, unknown> = { config: params.config, optLevel: params.optLevel }
        // Send files array for multi-file support, single code for backward compatibility
        if (params.files.length === 1) {
          payload.code = params.files[0].code
          payload.language = params.files[0].language
        } else {
          payload.files = params.files.map(f => ({ name: f.name, code: f.code, language: f.language }))
          payload.language = params.files[0].language
        }
        if (params.config === 'custom') payload.customConfig = params.customConfig
        if (params.defines.length > 0) payload.defines = params.defines.filter(d => d.name.trim())
        if (params.prefetchPolicy !== 'none') payload.prefetch = params.prefetchPolicy
        if (params.sampleRate > 1) payload.sample = params.sampleRate
        if (params.eventLimit > 0) payload.limit = params.eventLimit

        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (data.type || data.error) params.onErrorChange(data as ErrorResult)
        else if (data.levels) params.onResultChange(data as CacheResult)
        else params.onErrorChange({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        params.onErrorChange({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        stageRef.current = 'idle'
        params.onStageChange('idle')
      }
    }
  }, [
    params.files,
    params.mainFileId,
    params.config,
    params.optLevel,
    params.prefetchPolicy,
    params.customConfig,
    params.defines,
    params.sampleRate,
    params.eventLimit,
    params.selectedCompiler,
    params.longRunning,
    params.onStageChange,
    params.onResultChange,
    params.onErrorChange,
    params.onLongRunningChange
  ])

  return { runAnalysis }
}
