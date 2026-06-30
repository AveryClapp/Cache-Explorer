import type { CacheResult, HardwareExperimentResult, HardwareProfile } from '../types'

interface BatchExportResult {
  config: string
  result: CacheResult
}

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

function downloadJSON(filename: string, payload: unknown) {
  downloadText(filename, JSON.stringify(payload, null, 2), 'application/json')
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(',')
}

function metricRow(label: string, value: unknown) {
  return csvRow([label, value])
}

function profileName(config: string, result: CacheResult) {
  return result.profile?.displayName || config
}

function estimatedCycles(result: CacheResult) {
  return result.summary?.estimatedCycles ?? result.timing?.totalCycles ?? null
}

function topSource(result: CacheResult) {
  const source = result.summary?.topSource
  return source ? `${source.file}:${source.line}` : ''
}

function hitRate(result: CacheResult, level: 'l1d' | 'l2' | 'l3') {
  if (level === 'l1d') return result.levels.l1d?.hitRate ?? result.levels.l1?.hitRate ?? null
  return result.levels[level]?.hitRate ?? null
}

function percent(value: number | null | undefined) {
  return typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : ''
}

function numericDelta(value: number | undefined, baseline: number | undefined) {
  return typeof value === 'number' && typeof baseline === 'number' ? value - baseline : ''
}

export function exportAsJSON(result: CacheResult) {
  downloadJSON(`cache-analysis-${dateStamp()}.json`, result)
}

export function exportAsCSV(result: CacheResult) {
  const lines: string[] = [csvRow(['Metric', 'Value'])]
  if (result.profile) {
    lines.push(metricRow('Hardware Profile', result.profile.displayName))
    lines.push(metricRow('Hardware Vendor', result.profile.vendor))
    lines.push(metricRow('Model Confidence', result.profile.modelConfidence))
    if (result.profile.details) {
      const { executionCore, memory, prefetch, topology } = result.profile.details
      lines.push(metricRow('Hardware Cores', topology.activeCores))
      lines.push(metricRow('Execution Core', `${executionCore.issueWidth}-wide ROB ${executionCore.robSize}`))
      lines.push(metricRow('Branch Predictor', executionCore.branchPredictor))
      lines.push(metricRow('Prefetch Policy', prefetch.activePolicy))
      lines.push(metricRow('DRAM Latency Cycles', memory.dramCycles))
    }
  }
  if (result.summary) {
    lines.push(metricRow('Primary Bottleneck', result.summary.primaryBottleneck))
    lines.push(metricRow('Estimated Cycles', result.summary.estimatedCycles))
    lines.push(metricRow('Bottleneck Share', `${(result.summary.bottleneckShare * 100).toFixed(2)}%`))
    lines.push(metricRow('Bottleneck Confidence', result.summary.confidence))
    if (result.summary.topSource) {
      lines.push(metricRow('Bottleneck Source', `${result.summary.topSource.file}:${result.summary.topSource.line}`))
    }
  }
  const l1 = result.levels.l1d || result.levels.l1
  if (l1) {
    lines.push(metricRow('L1 Hits', l1.hits))
    lines.push(metricRow('L1 Misses', l1.misses))
    lines.push(metricRow('L1 Hit Rate', `${(l1.hitRate * 100).toFixed(2)}%`))
  }
  if (result.levels.l2) {
    lines.push(metricRow('L2 Hits', result.levels.l2.hits))
    lines.push(metricRow('L2 Misses', result.levels.l2.misses))
    lines.push(metricRow('L2 Hit Rate', `${(result.levels.l2.hitRate * 100).toFixed(2)}%`))
  }
  if (result.levels.l3) {
    lines.push(metricRow('L3 Hits', result.levels.l3.hits))
    lines.push(metricRow('L3 Misses', result.levels.l3.misses))
    lines.push(metricRow('L3 Hit Rate', `${(result.levels.l3.hitRate * 100).toFixed(2)}%`))
  }
  if (result.timing) {
    lines.push(metricRow('Total Cycles', result.timing.totalCycles))
    lines.push(metricRow('Avg Latency', result.timing.avgLatency.toFixed(2)))
  }
  if (result.execution?.available) {
    if (result.execution.pipeline) {
      lines.push(metricRow('Estimated Instructions', result.execution.pipeline.instructions))
      lines.push(metricRow('Estimated Execution Cycles', result.execution.pipeline.cycles))
      lines.push(metricRow('Estimated IPC', result.execution.pipeline.ipc.toFixed(3)))
      lines.push(metricRow('Estimated CPI', result.execution.pipeline.cpi.toFixed(3)))
    }
    if (result.execution.branchPrediction) {
      lines.push(metricRow('Branches', result.execution.branchPrediction.total))
      lines.push(metricRow('Branch Mispredictions', result.execution.branchPrediction.mispredictions))
      lines.push(metricRow('Branch Accuracy', `${(result.execution.branchPrediction.accuracy * 100).toFixed(2)}%`))
    }
  }
  lines.push(metricRow('Total Events', result.events))
  downloadText(`cache-analysis-${dateStamp()}.csv`, lines.join('\n'), 'text/csv')
}

export function exportBatchResultsAsJSON(results: BatchExportResult[]) {
  downloadJSON(`hardware-comparison-${dateStamp()}.json`, {
    generatedAt: new Date().toISOString(),
    results,
  })
}

export function exportBatchResultsAsCSV(results: BatchExportResult[]) {
  const rows = [
    csvRow([
      'Hardware',
      'Config',
      'Vendor',
      'Class',
      'Bottleneck',
      'Estimated Cycles',
      'L1D Hit',
      'L2 Hit',
      'L3 Hit',
      'Top Source',
      'Events',
      'Model Confidence',
    ]),
  ]

  for (const { config, result } of results) {
    rows.push(csvRow([
      profileName(config, result),
      config,
      result.profile?.vendor,
      result.profile?.class,
      result.summary?.primaryBottleneck || 'unknown',
      estimatedCycles(result),
      percent(hitRate(result, 'l1d')),
      percent(hitRate(result, 'l2')),
      percent(hitRate(result, 'l3')),
      topSource(result),
      result.events,
      result.profile?.modelConfidence,
    ]))
  }

  downloadText(`hardware-comparison-${dateStamp()}.csv`, rows.join('\n'), 'text/csv')
}

export function exportExperimentAsJSON(result: HardwareExperimentResult) {
  downloadJSON(`hardware-experiment-${dateStamp()}.json`, {
    generatedAt: new Date().toISOString(),
    ...result,
  })
}

export function exportExperimentAsCSV(result: HardwareExperimentResult) {
  const rows = [
    csvRow([
      'Variant',
      'Variant Spec',
      'Hardware',
      'Config',
      'Vendor',
      'Bottleneck',
      'Estimated Cycles',
      'Cycle Delta',
      'Cycle Delta Percent',
      'L1D Hit',
      'L2 Hit',
      'L3 Hit',
      'Top Source',
      'Events',
      'Confidence',
    ]),
  ]

  for (const row of result.summary) {
    rows.push(csvRow([
      row.variant,
      row.variantSpec,
      row.profile?.displayName || row.config,
      row.config,
      row.profile?.vendor,
      row.primaryBottleneck,
      row.estimatedCycles,
      row.cycleDelta,
      percent(row.cycleDeltaPercent),
      percent(row.hitRates?.l1d),
      percent(row.hitRates?.l2),
      percent(row.hitRates?.l3),
      row.topSource ? `${row.topSource.file}:${row.topSource.line}` : '',
      row.events,
      row.confidence,
    ]))
  }

  downloadText(`hardware-experiment-${dateStamp()}.csv`, rows.join('\n'), 'text/csv')
}

export function exportHardwareProfilesAsJSON(profiles: HardwareProfile[], baseline?: HardwareProfile) {
  downloadJSON(`hardware-profiles-${dateStamp()}.json`, {
    generatedAt: new Date().toISOString(),
    baselineId: baseline?.id || null,
    profiles,
  })
}

export function exportHardwareProfilesAsCSV(profiles: HardwareProfile[], baseline?: HardwareProfile) {
  const baselineDetails = baseline?.details
  const rows = [
    csvRow([
      'Profile',
      'ID',
      'Vendor',
      'Architecture',
      'Class',
      'Confidence',
      'Validation',
      'Baseline',
      'L1D KB',
      'L1D Delta KB',
      'L2 KB',
      'L2 Delta KB',
      'L3 KB',
      'L3 Delta KB',
      'DRAM Cycles',
      'DRAM Delta Cycles',
      'Issue Width',
      'Issue Width Delta',
      'Vector Bits',
      'Vector Delta Bits',
      'DRAM GB/s',
      'DRAM GB/s Delta',
      'MLP',
      'MLP Delta',
      'Prefetch',
      'Execution Coverage',
      'SIMD Coverage',
      'Bandwidth Coverage',
      'Notes',
    ]),
  ]

  for (const profile of profiles) {
    const details = profile.details
    rows.push(csvRow([
      profile.displayName,
      profile.id,
      profile.vendor,
      profile.architecture,
      profile.class,
      profile.modelConfidence,
      profile.validation?.confidence,
      baseline?.id === profile.id ? 'yes' : '',
      details?.cache.levels.l1d.sizeKB,
      numericDelta(details?.cache.levels.l1d.sizeKB, baselineDetails?.cache.levels.l1d.sizeKB),
      details?.cache.levels.l2.sizeKB,
      numericDelta(details?.cache.levels.l2.sizeKB, baselineDetails?.cache.levels.l2.sizeKB),
      details?.cache.levels.l3.sizeKB,
      numericDelta(details?.cache.levels.l3.sizeKB, baselineDetails?.cache.levels.l3.sizeKB),
      details?.memory.dramCycles,
      numericDelta(details?.memory.dramCycles, baselineDetails?.memory.dramCycles),
      details?.executionCore.issueWidth,
      numericDelta(details?.executionCore.issueWidth, baselineDetails?.executionCore.issueWidth),
      details?.executionCore.vectorBits,
      numericDelta(details?.executionCore.vectorBits, baselineDetails?.executionCore.vectorBits),
      details?.memory.dramBandwidthGBs,
      numericDelta(details?.memory.dramBandwidthGBs, baselineDetails?.memory.dramBandwidthGBs),
      details?.memory.maxMemoryLevelParallelism,
      numericDelta(details?.memory.maxMemoryLevelParallelism, baselineDetails?.memory.maxMemoryLevelParallelism),
      details?.prefetch.activePolicy,
      profile.modelCoverage?.executionCore,
      profile.modelCoverage?.simd,
      profile.modelCoverage?.bandwidth,
      profile.notes,
    ]))
  }

  downloadText(`hardware-profiles-${dateStamp()}.csv`, rows.join('\n'), 'text/csv')
}
