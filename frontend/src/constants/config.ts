import type { PrefetchPolicy, CustomCacheConfig } from '../types'

// API Configuration
export const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'

export const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

// Default prefetch policies for hardware presets (based on real hardware behavior)
export const PREFETCH_DEFAULTS: Record<string, PrefetchPolicy> = {
  // Intel uses aggressive stream prefetchers + adjacent line prefetcher
  intel: 'stream',
  intel14: 'stream',
  xeon: 'stream',
  // AMD Zen uses stride + stream detection
  amd: 'adaptive',
  zen3: 'adaptive',
  zen4: 'adaptive',
  epyc: 'adaptive',
  // Apple Silicon has very aggressive stream prefetchers
  apple: 'stream',
  m1: 'stream',
  m2: 'stream',
  m3: 'stream',
  // ARM uses stream prefetching
  graviton: 'stream',
  rpi4: 'next',
  // Embedded often has simple or no prefetching
  embedded: 'next',
  // Educational - no prefetch to show raw behavior
  educational: 'none',
  // Custom - user decides
  custom: 'none',
}

export const PREFETCH_DEFAULTS_ENTRIES = Object.entries(PREFETCH_DEFAULTS)

// Config display names
export const CONFIG_NAMES: Record<string, string> = {
  educational: 'Educational',
  intel: 'Intel 12th Gen',
  intel14: 'Intel 14th Gen',
  xeon: 'Intel Xeon',
  zen3: 'AMD Zen 3',
  amd: 'AMD Zen 4',
  epyc: 'AMD EPYC',
  apple: 'Apple M1',
  m2: 'Apple M2',
  m3: 'Apple M3',
  graviton: 'AWS Graviton 3',
  rpi4: 'Raspberry Pi 4',
  embedded: 'Embedded',
  custom: 'Custom'
}

export const CONFIG_NAMES_ENTRIES = Object.entries(CONFIG_NAMES)

// Optimization levels
export const OPTIMIZATION_LEVELS = ['-O0', '-O1', '-O2', '-O3', '-Os', '-Oz']

// Default custom cache configuration
export const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32768,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

// Stage display text
export const STAGE_TEXT: Record<string, string> = {
  idle: '',
  connecting: 'Connecting...',
  preparing: 'Preparing...',
  compiling: 'Compiling...',
  running: 'Running...',
  processing: 'Processing...',
  done: ''
}
