export type ProductArea = 'analyze' | 'profiles' | 'comparisons' | 'workloads' | 'experiments' | 'binary' | 'lab'

/** Areas that live under the single Compare destination. */
export const COMPARE_AREAS: readonly ProductArea[] = ['comparisons', 'experiments', 'lab']

export function isCompareArea(area: ProductArea) {
  return COMPARE_AREAS.includes(area)
}

export function productHref(area: ProductArea) {
  const url = new URL(window.location.href)
  if (area === 'analyze') url.searchParams.delete('view')
  else url.searchParams.set('view', area)
  return `${url.pathname}${url.search}${url.hash}`
}
