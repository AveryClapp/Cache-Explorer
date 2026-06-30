import type { CacheResult } from '../types'

function dateStamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(label: string, value: unknown) {
  return `${csvCell(label)},${csvCell(value)}`
}

export function exportAsJSON(result: CacheResult) {
  downloadText(`cache-analysis-${dateStamp()}.json`, JSON.stringify(result, null, 2), 'application/json')
}

export function exportAsCSV(result: CacheResult) {
  const lines: string[] = ['Metric,Value']
  const l1 = result.levels.l1d || result.levels.l1
  if (l1) {
    lines.push(csvRow('L1 Hits', l1.hits))
    lines.push(csvRow('L1 Misses', l1.misses))
    lines.push(csvRow('L1 Hit Rate', `${(l1.hitRate * 100).toFixed(2)}%`))
  }
  if (result.levels.l2) {
    lines.push(csvRow('L2 Hits', result.levels.l2.hits))
    lines.push(csvRow('L2 Misses', result.levels.l2.misses))
    lines.push(csvRow('L2 Hit Rate', `${(result.levels.l2.hitRate * 100).toFixed(2)}%`))
  }
  if (result.levels.l3) {
    lines.push(csvRow('L3 Hits', result.levels.l3.hits))
    lines.push(csvRow('L3 Misses', result.levels.l3.misses))
    lines.push(csvRow('L3 Hit Rate', `${(result.levels.l3.hitRate * 100).toFixed(2)}%`))
  }
  if (result.timing) {
    lines.push(csvRow('Total Cycles', result.timing.totalCycles))
    lines.push(csvRow('Avg Latency', result.timing.avgLatency.toFixed(2)))
  }
  lines.push(csvRow('Total Events', result.events))
  downloadText(`cache-analysis-${dateStamp()}.csv`, lines.join('\n'), 'text/csv')
}
