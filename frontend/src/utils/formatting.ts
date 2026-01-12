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
