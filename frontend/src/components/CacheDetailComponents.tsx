import type { ReactNode } from 'react'
import type { CacheStats, TLBStats } from '../types'
import { formatPercent } from '../utils/formatting'

interface CacheLevelDetailProps {
  name: string
  stats: CacheStats
}

export function LevelDetail({ name, stats }: CacheLevelDetailProps): ReactNode {
  const has3C = stats.compulsory !== undefined || stats.capacity !== undefined || stats.conflict !== undefined
  const total3C = (stats.compulsory || 0) + (stats.capacity || 0) + (stats.conflict || 0)

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
      {has3C && total3C > 0 && (
        <div className="level-3c">
          <div className="level-3c-header">Miss Breakdown</div>
          <div className="level-3c-bar">
            {stats.compulsory! > 0 && (
              <div
                className="level-3c-segment compulsory"
                style={{ width: `${(stats.compulsory! / total3C) * 100}%` }}
                title={`Cold: ${stats.compulsory!.toLocaleString()} (${((stats.compulsory! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
            {stats.capacity! > 0 && (
              <div
                className="level-3c-segment capacity"
                style={{ width: `${(stats.capacity! / total3C) * 100}%` }}
                title={`Capacity: ${stats.capacity!.toLocaleString()} (${((stats.capacity! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
            {stats.conflict! > 0 && (
              <div
                className="level-3c-segment conflict"
                style={{ width: `${(stats.conflict! / total3C) * 100}%` }}
                title={`Conflict: ${stats.conflict!.toLocaleString()} (${((stats.conflict! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
          </div>
          <div className="level-3c-details">
            {stats.compulsory! > 0 && (
              <div className="level-3c-item">
                <span className="dot compulsory" />
                <span className="label">Cold</span>
                <span className="value">{stats.compulsory!.toLocaleString()}</span>
                <span className="percent">{((stats.compulsory! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
            {stats.capacity! > 0 && (
              <div className="level-3c-item">
                <span className="dot capacity" />
                <span className="label">Capacity</span>
                <span className="value">{stats.capacity!.toLocaleString()}</span>
                <span className="percent">{((stats.capacity! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
            {stats.conflict! > 0 && (
              <div className="level-3c-item">
                <span className="dot conflict" />
                <span className="label">Conflict</span>
                <span className="value">{stats.conflict!.toLocaleString()}</span>
                <span className="percent">{((stats.conflict! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      )}
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
