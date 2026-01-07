import { useState } from 'react'
import type { CacheResult, ErrorResult, Stage } from '../types'

export function useResultState() {
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)

  return {
    result,
    setResult,
    stage,
    setStage,
    error,
    setError
  }
}
