export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export function getRateClass(rate: number): string {
  return rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qIdx = 0
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) qIdx++
  }
  return qIdx === q.length
}
