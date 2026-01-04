export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

export function getRateClass(rate: number): string {
  return rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'
}
