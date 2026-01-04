import { useState } from 'react'
import type { CacheResult, ErrorResult, Stage, TimelineEvent } from '../types'

export function useResultState() {
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)

  return {
    result,
    setResult,
    stage,
    setStage,
    error,
    setError,
    timeline,
    setTimeline,
    scrubberIndex,
    setScrubberIndex
  }
}
