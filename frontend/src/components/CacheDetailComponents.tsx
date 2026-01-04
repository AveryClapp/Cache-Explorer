import type { ReactNode } from 'react'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks?: number
}

interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

interface CacheLevelDetailProps {
  name: string
  stats: CacheStats
}

export function LevelDetail({ name, stats }: CacheLevelDetailProps): ReactNode {
  return (
    <div className="level-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
    </div>
  )
}

interface TLBDetailProps {
  name: string
  stats: TLBStats
}

export function TLBDetail({ name, stats }: TLBDetailProps): ReactNode {
  const totalAccesses = stats.hits + stats.misses
  if (totalAccesses === 0) return null

  return (
    <div className="level-detail tlb-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.95 ? 'good' : stats.hitRate > 0.85 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
    </div>
  )
}
