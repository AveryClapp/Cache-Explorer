import { CacheHierarchyLevel } from './CacheHierarchyDisplay'
import { TimingDisplay } from './TimingDisplay'
import { formatNumericDelta } from '../utils/formatting'
import type { CacheResult } from '../types'

interface CacheHierarchyVizProps {
  result: CacheResult
  baselineResult?: CacheResult | null
  diffMode: boolean
}

export function CacheHierarchyViz({ result, baselineResult, diffMode }: CacheHierarchyVizProps) {
  const hasL3 = (result.cacheConfig?.l3?.sizeKB ?? 0) > 0
  const dramAccesses = hasL3 ? result.levels.l3.misses : result.levels.l2.misses
  const baselineDram = baselineResult
    ? ((baselineResult.cacheConfig?.l3?.sizeKB ?? 0) > 0
        ? baselineResult.levels.l3?.misses
        : baselineResult.levels.l2?.misses)
    : null
  const dramDelta = diffMode && baselineDram != null ? formatNumericDelta(dramAccesses, baselineDram) : null

  return (
    <div className="cache-hierarchy">
      <div className="cache-hierarchy-title">Cache Hierarchy</div>
      <div className="cache-levels">
        <CacheHierarchyLevel
          name="L1"
          hitRate={(result.levels.l1d || result.levels.l1!).hitRate}
        />
        <div className="cache-connector" />
        <CacheHierarchyLevel
          name="L2"
          hitRate={result.levels.l2.hitRate}
        />
        {hasL3 && (
          <>
            <div className="cache-connector" />
            <CacheHierarchyLevel
              name="L3"
              hitRate={result.levels.l3.hitRate}
            />
          </>
        )}
        <div className="cache-connector" />
        <div className="memory-stats">
          <span className="memory-stats-label">DRAM</span>
          <span className="memory-stats-value">
            {dramAccesses.toLocaleString()} accesses
            {dramDelta && !dramDelta.isNeutral && (
              <span className={`memory-delta ${dramDelta.isWorse ? 'worse' : 'better'}`}>
                {dramDelta.text}
              </span>
            )}
          </span>
        </div>
      </div>
      {result.timing && (
        <TimingDisplay
          timing={result.timing}
          baselineTiming={baselineResult?.timing}
          diffMode={diffMode}
        />
      )}
    </div>
  )
}
