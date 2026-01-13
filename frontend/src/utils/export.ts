import type { CacheResult } from '../types'

export function exportAsJSON(result: CacheResult) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cache-analysis-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportAsCSV(result: CacheResult) {
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
}
