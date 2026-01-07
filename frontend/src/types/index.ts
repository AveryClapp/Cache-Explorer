// All type interfaces extracted from App.tsx

export interface Compiler {
  id: string
  name: string
  version: string
  major: number
  path: string
  source: string
  default?: boolean
}

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

export interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

export interface TLBHierarchyStats {
  dtlb: TLBStats
  itlb: TLBStats
}

export interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
  threads?: number
}

export interface FalseSharingAccess {
  threadId: number
  offset: number
  isWrite: boolean
  file: string
  line: number
  count: number
}

export interface FalseSharingEvent {
  cacheLineAddr: string
  accessCount: number
  accesses: FalseSharingAccess[]
}

export interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

export interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
  notes?: string[]
  sourceLine?: string
  caret?: string
}

export interface ErrorResult {
  type: 'compile_error' | 'linker_error' | 'runtime_error' | 'timeout' | 'unknown_error' | 'validation_error' | 'server_error'
  errors?: CompileError[]
  summary?: string
  message?: string
  suggestion?: string
  raw?: string
  error?: string
}

export interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

export interface CacheLevelConfig {
  sizeKB: number
  assoc: number
  lineSize: number
  sets: number
}

export interface CacheConfig {
  l1d: CacheLevelConfig
  l1i: CacheLevelConfig
  l2: CacheLevelConfig
  l3: CacheLevelConfig
}

export interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
}

export interface CacheLineState {
  s: number      // set
  w: number      // way
  v: number      // valid (0 or 1)
  t?: string     // tag (hex string)
  st?: string    // state: M, E, S, I
}

export interface CoreCacheState {
  core: number
  sets: number
  ways: number
  lines: CacheLineState[]
}

export interface CacheState {
  l1d: CoreCacheState[]
}

export interface CacheResult {
  config: string
  events: number
  multicore?: boolean
  cores?: number
  threads?: number
  cacheConfig?: CacheConfig
  levels: {
    l1?: CacheStats
    l1d?: CacheStats
    l1i?: CacheStats
    l2: CacheStats
    l3: CacheStats
  }
  coherence?: CoherenceStats
  hotLines: HotLine[]
  falseSharing?: FalseSharingEvent[]
  suggestions?: OptimizationSuggestion[]
  prefetch?: PrefetchStats
  cacheState?: CacheState
  tlb?: TLBHierarchyStats
}

export type Language = 'c' | 'cpp' | 'rust'

export interface FileTab {
  id: string
  name: string
  code: string
  language: Language
}

export interface Example {
  name: string
  code: string
  description: string
  language: Language
}

export type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

export interface DefineEntry {
  name: string
  value: string
}

export interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

export interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

export type PrefetchPolicy = 'none' | 'next' | 'stream' | 'stride' | 'adaptive'

export type Theme = 'dark' | 'light'
