import { useCallback, useRef, useState } from 'react'

const DEFAULT_PROGRESS_RENDER_INTERVAL_MS = 120

export interface AnalysisProgress {
  eventsProcessed: number
  eventsTotal: number
}

function toNonNegativeCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, count) : 0
}

export function normalizeProgressMessage(message: { eventsProcessed?: unknown; eventsTotal?: unknown }): AnalysisProgress {
  return {
    eventsProcessed: toNonNegativeCount(message.eventsProcessed),
    eventsTotal: toNonNegativeCount(message.eventsTotal),
  }
}

export function useThrottledProgress(intervalMs = DEFAULT_PROGRESS_RENDER_INTERVAL_MS) {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingProgressRef = useRef<AnalysisProgress | null>(null)
  const lastRenderRef = useRef(0)

  const clearProgress = useCallback(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current)
      renderTimeoutRef.current = null
    }
    pendingProgressRef.current = null
    lastRenderRef.current = 0
    setProgress(null)
  }, [])

  const queueProgress = useCallback((nextProgress: AnalysisProgress) => {
    pendingProgressRef.current = nextProgress
    const now = Date.now()
    const elapsed = now - lastRenderRef.current

    if (elapsed >= intervalMs) {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current)
        renderTimeoutRef.current = null
      }
      lastRenderRef.current = now
      setProgress(nextProgress)
      return
    }

    if (!renderTimeoutRef.current) {
      renderTimeoutRef.current = setTimeout(() => {
        renderTimeoutRef.current = null
        lastRenderRef.current = Date.now()
        if (pendingProgressRef.current) {
          setProgress(pendingProgressRef.current)
        }
      }, intervalMs - elapsed)
    }
  }, [intervalMs])

  return {
    progress,
    queueProgress,
    clearProgress,
  }
}
