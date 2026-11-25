import type { HotLine } from '../types'

export type LineMetric = 'l1Misses' | 'memoryMisses' | 'stallCycles' | 'branchMispredictions'

export interface LineMetricInfo {
  id: LineMetric
  /** Selector label */
  label: string
  /** Singular and plural unit for counts */
  unit: [string, string]
  hint: string
  read: (line: HotLine) => number | undefined
}

export const LINE_METRICS: LineMetricInfo[] = [
  {
    id: 'l1Misses',
    label: 'L1 misses',
    unit: ['miss', 'misses'],
    hint: 'Accesses that missed the L1 cache',
    read: line => line.misses,
  },
  {
    id: 'memoryMisses',
    label: 'Memory misses',
    unit: ['miss', 'misses'],
    hint: 'Accesses that missed every cache level and went to DRAM',
    read: line => line.memoryMisses,
  },
  {
    id: 'stallCycles',
    label: 'Stall cycles',
    unit: ['cycle', 'cycles'],
    hint: 'Estimated cycles the pipeline stalled on this line (memory, front end and branches)',
    read: line => line.stallCycles,
  },
  {
    id: 'branchMispredictions',
    label: 'Branch mispredicts',
    unit: ['mispredict', 'mispredicts'],
    hint: 'Branch mispredictions at this line',
    read: line => line.branchMispredictions,
  },
]

export const DEFAULT_LINE_METRIC: LineMetric = 'l1Misses'

export function lineMetricInfo(metric: LineMetric): LineMetricInfo {
  return LINE_METRICS.find(info => info.id === metric) ?? LINE_METRICS[0]
}

export function lineMetricValue(line: HotLine, metric: LineMetric): number {
  return lineMetricInfo(metric).read(line) ?? 0
}

/** Metrics the result reports per line. Older results carry only L1 misses. */
export function availableLineMetrics(lines: HotLine[]): LineMetric[] {
  return LINE_METRICS
    .filter(info => info.id === 'l1Misses' || lines.some(line => info.read(line) !== undefined))
    .map(info => info.id)
}

export function formatMetricCount(value: number, metric: LineMetric) {
  const [one, many] = lineMetricInfo(metric).unit
  return `${value.toLocaleString()} ${value === 1 ? one : many}`
}

export function isLineMetric(value: unknown): value is LineMetric {
  return LINE_METRICS.some(info => info.id === value)
}
