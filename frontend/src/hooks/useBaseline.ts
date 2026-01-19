import { useState, useEffect, useCallback } from 'react'
import type { CacheResult } from '../types'

interface Baseline {
  timestamp: number
  sourceHash: string
  config: string
  result: CacheResult
}

const STORAGE_KEY = 'cache-explorer-baseline'

function hashFiles(files: { name: string }[]): string {
  return files.map(f => f.name).sort().join('|')
}

export function useBaseline(currentFiles: { name: string }[]) {
  const [baseline, setBaseline] = useState<Baseline | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Baseline
        // Only restore if file set matches
        if (parsed.sourceHash === hashFiles(currentFiles)) {
          return parsed
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null
  })

  const [diffMode, setDiffMode] = useState(false)

  // Persist to localStorage when baseline changes
  useEffect(() => {
    if (baseline) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [baseline])

  const setBaselineResult = useCallback((result: CacheResult, config: string, files: { name: string }[]) => {
    setBaseline({
      timestamp: Date.now(),
      sourceHash: hashFiles(files),
      config,
      result,
    })
  }, [])

  const clearBaseline = useCallback(() => {
    setBaseline(null)
    setDiffMode(false)
  }, [])

  // Check if current file set matches baseline
  const baselineValid = baseline ? baseline.sourceHash === hashFiles(currentFiles) : false

  return {
    baseline: baselineValid ? baseline : null,
    baselineResult: baselineValid ? baseline?.result ?? null : null,
    baselineConfig: baselineValid ? baseline?.config ?? null : null,
    baselineTimestamp: baselineValid ? baseline?.timestamp ?? null : null,
    diffMode,
    setDiffMode,
    setBaseline: setBaselineResult,
    clearBaseline,
  }
}
