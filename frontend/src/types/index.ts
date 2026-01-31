// Cache Explorer Type Definitions
// Single source of truth for all TypeScript interfaces

// =============================================================================
// CACHE STATISTICS
// =============================================================================

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
  // 3C miss classification (only available when fast mode is disabled)
  compulsory?: number  // Cold misses - first access ever
  capacity?: number    // Working set exceeds cache size
  conflict?: number    // Limited associativity caused eviction
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

export interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

export interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
}

// =============================================================================
// ADVANCED INSTRUMENTATION STATS
// =============================================================================

export interface SoftwarePrefetchStats {
  issued: number
  useful: number
  accuracy: number
}

export interface VectorStats {
  loads: number
  stores: number
  bytesLoaded: number
  bytesStored: number
  crossLineAccesses: number
}

export interface AtomicStats {
  loads: number
  stores: number
  rmw: number
  cmpxchg: number
}

export interface MemoryIntrinsicStats {
  memcpyCount: number
  memcpyBytes: number
  memsetCount: number
  memsetBytes: number
  memmoveCount: number
  memmoveBytes: number
}

export interface AdvancedStats {
  softwarePrefetch?: SoftwarePrefetchStats
  vector?: VectorStats
  atomic?: AtomicStats
  memoryIntrinsics?: MemoryIntrinsicStats
}

// =============================================================================
// TIMING STATS
// =============================================================================

export interface TimingBreakdown {
  l1HitCycles: number
  l2HitCycles: number
  l3HitCycles: number
  memoryCycles: number
  tlbMissCycles: number
}

export interface LatencyConfig {
  l1Hit: number
  l2Hit: number
  l3Hit: number
  memory: number
  tlbMissPenalty: number
}

export interface TimingStats {
  totalCycles: number
  avgLatency: number
  breakdown: TimingBreakdown
  latencyConfig: LatencyConfig
}

// =============================================================================
// HOT LINES & FALSE SHARING
// =============================================================================

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

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

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

export interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

// =============================================================================
// CACHE STATE (FOR VISUALIZATION)
// =============================================================================

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

// =============================================================================
// ANALYSIS RESULTS
// =============================================================================

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
  timing?: TimingStats
  advancedStats?: AdvancedStats
}

export interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

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

// =============================================================================
// FILES & EDITOR
// =============================================================================

export type Language = 'c' | 'cpp' | 'zig'

export interface FileTab {
  id: string
  name: string
  code: string
  language: Language
  isMain?: boolean
}

export interface ExampleFile {
  name: string
  code: string
  language: Language
  isMain?: boolean
}

export interface Example {
  name: string
  code: string
  description: string
  language: Language
  files?: ExampleFile[]  // Optional multi-file support
}

// =============================================================================
// UI STATE
// =============================================================================

export type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

export type Theme = 'dark' | 'light'

export type PrefetchPolicy = 'none' | 'next' | 'stream' | 'stride' | 'adaptive'

export interface DefineEntry {
  name: string
  value: string
}

export interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

// =============================================================================
// UI COMPONENTS
// =============================================================================

export interface SelectOption {
  value: string
  label: string
  group?: string
  desc?: string
}

export interface Compiler {
  id: string
  name: string
  version: string
  major: number
  path: string
  source: string
  default?: boolean
}
