import type { SelectOption } from '../types'

export const HARDWARE_OPTIONS: SelectOption[] = [
  { value: 'educational', label: 'Educational', group: 'Learning', desc: 'Small caches (4KB L1) - easy to see misses' },
  { value: 'custom', label: 'Custom', group: 'Custom', desc: 'Configure your own cache sizes' },
  { value: 'intel', label: 'Intel 12th Gen', group: 'Intel', desc: '48KB L1, 1.25MB L2, 30MB L3' },
  { value: 'intel14', label: 'Intel 14th Gen', group: 'Intel', desc: '48KB L1, 2MB L2, 36MB L3' },
  { value: 'xeon', label: 'Intel Xeon', group: 'Intel', desc: '48KB L1, 2MB L2, 60MB L3' },
  { value: 'zen3', label: 'AMD Zen 3', group: 'AMD', desc: '32KB L1, 512KB L2, 32MB L3' },
  { value: 'amd', label: 'AMD Zen 4', group: 'AMD', desc: '32KB L1, 1MB L2, 32MB L3' },
  { value: 'epyc', label: 'AMD EPYC', group: 'AMD', desc: '32KB L1, 512KB L2, 256MB L3' },
  { value: 'apple', label: 'Apple M1', group: 'Apple', desc: '64KB L1, 4MB L2, 32MB SLC' },
  { value: 'm2', label: 'Apple M2', group: 'Apple', desc: '128KB L1, 16MB L2, 24MB SLC' },
  { value: 'm3', label: 'Apple M3', group: 'Apple', desc: '128KB L1, 32MB L2, 32MB SLC' },
  { value: 'graviton', label: 'AWS Graviton 3', group: 'ARM', desc: '64KB L1, 1MB L2, 32MB L3' },
  { value: 'rpi4', label: 'Raspberry Pi 4', group: 'ARM', desc: '32KB L1, 1MB L2' },
]

export const OPT_LEVEL_OPTIONS: SelectOption[] = [
  { value: '-O0', label: '-O0', desc: 'No optimization - best for debugging' },
  { value: '-O1', label: '-O1', desc: 'Basic optimizations' },
  { value: '-O2', label: '-O2', desc: 'Standard optimizations' },
  { value: '-O3', label: '-O3', desc: 'Aggressive optimizations' },
  { value: '-Os', label: '-Os', desc: 'Optimize for size' },
]

export const PREFETCH_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None', desc: 'No hardware prefetching' },
  { value: 'next', label: 'Next Line', desc: 'Prefetch adjacent cache line on miss' },
  { value: 'stream', label: 'Stream', desc: 'Detect sequential access patterns' },
  { value: 'stride', label: 'Stride', desc: 'Detect strided access patterns' },
  { value: 'adaptive', label: 'Adaptive', desc: 'Combines stream + stride detection' },
  { value: 'intel', label: 'Intel DCU', desc: 'Intel Data Cache Unit prefetcher' },
]

export const LIMIT_OPTIONS: SelectOption[] = [
  { value: '10000', label: '10K' },
  { value: '50000', label: '50K' },
  { value: '100000', label: '100K' },
  { value: '500000', label: '500K' },
  { value: '1000000', label: '1M' },
]

export const SAMPLE_OPTIONS: SelectOption[] = [
  { value: '1', label: '1:1 (all)' },
  { value: '2', label: '1:2' },
  { value: '4', label: '1:4' },
  { value: '8', label: '1:8' },
  { value: '16', label: '1:16' },
]

export const FAST_MODE_OPTIONS: SelectOption[] = [
  { value: 'false', label: 'Full (3C)', desc: 'Tracks compulsory, capacity, conflict misses' },
  { value: 'true', label: 'Fast', desc: '~3x faster, skips miss classification' },
]

