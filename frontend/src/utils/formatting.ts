/**
 * Format a decimal rate as a percentage string
 */
export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

/**
 * Get CSS class based on hit rate quality
 */
export function getRateClass(rate: number): string {
  return rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'
}

/**
 * Format a delta between two rates as a percentage change
 */
export function formatDelta(current: number, baseline: number): { text: string; isPositive: boolean; isNeutral: boolean } {
  const delta = current - baseline
  const deltaPercent = (delta * 100).toFixed(1)
  if (Math.abs(delta) < 0.001) {
    return { text: '0%', isPositive: false, isNeutral: true }
  }
  return { text: (delta > 0 ? '+' : '') + deltaPercent + '%', isPositive: delta > 0, isNeutral: false }
}

/**
 * Format a numeric delta (for cycles, counts, etc.)
 * Positive delta = worse (more cycles/accesses)
 */
export function formatNumericDelta(current: number, baseline: number): { text: string; isWorse: boolean; isNeutral: boolean } {
  const delta = current - baseline
  if (delta === 0) {
    return { text: '0', isWorse: false, isNeutral: true }
  }
  const sign = delta > 0 ? '+' : ''
  return { text: `${sign}${delta.toLocaleString()}`, isWorse: delta > 0, isNeutral: false }
}

/**
 * Extract just filename:line from a full path like /tmp/cache-explorer-.../main.c:12
 */
export function formatLocation(location: string): string {
  // Extract just the filename and line number
  const match = location.match(/([^/]+:\d+)$/)
  return match ? match[1] : location
}

/**
 * Fuzzy match a query string against text
 */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qIdx = 0
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) qIdx++
  }
  return qIdx === q.length
}

const KEY_WORDS: Record<string, string> = {
  l1: 'L1', l1d: 'L1D', l1i: 'L1I', l2: 'L2', l3: 'L3', tlb: 'TLB', dtlb: 'DTLB', itlb: 'ITLB',
  mlp: 'MLP', simd: 'SIMD', numa: 'NUMA', ipc: 'IPC', mpki: 'MPKI', dram: 'DRAM',
}
const DROPPED_SEGMENTS = new Set(['levels', 'advancedStats', 'subsystems', 'summary', 'timing'])

// Turns data keys like "levels.l2.hitRate" or "memoryDemandPressure" into
// "L2 hit rate" / "Memory demand pressure" for display.
export function humanizeKey(key: string): string {
  const words = key
    .split('.')
    .filter((segment, index, all) => !(DROPPED_SEGMENTS.has(segment) && index < all.length - 1))
    .flatMap(segment => segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').split(' '))
    .filter(Boolean)
    .map(word => KEY_WORDS[word.toLowerCase()] ?? word.toLowerCase())
  if (words.length === 0) return key
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
