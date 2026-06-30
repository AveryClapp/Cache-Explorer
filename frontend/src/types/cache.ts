// Shared type definitions for cache simulation results

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
  compulsory?: number
  capacity?: number
  conflict?: number
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

export interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

export interface TLBHierarchyStats {
  dtlb: TLBStats
  itlb: TLBStats
}

export interface TimingBreakdown {
  l1HitCycles: number
  l2HitCycles: number
  l3HitCycles: number
  memoryCycles: number
  tlbMissCycles?: number
}

export interface LatencyConfig {
  l1Hit: number
  l2Hit: number
  l3Hit: number
  memory: number
  tlbMissPenalty?: number
}

export interface TimingStats {
  totalCycles: number
  avgLatency: number
  breakdown: TimingBreakdown
  latencyConfig: LatencyConfig
}

export interface HardwareProfile {
  id: string
  displayName: string
  vendor: string
  architecture: string
  class: string
  modelConfidence: string
  details?: HardwareProfileDetails
}

export interface HardwareProfileCacheLevel {
  sizeKB: number
  associativity: number
  lineSize: number
  sets: number
  replacement: string
  writePolicy: string
}

export interface HardwareProfileDetails {
  cache: {
    inclusion: string
    levels: {
      l1d: HardwareProfileCacheLevel
      l1i: HardwareProfileCacheLevel
      l2: HardwareProfileCacheLevel
      l3: HardwareProfileCacheLevel
    }
  }
  tlb: {
    dtlb: { entries: number; associativity: number; pageSize: number }
    itlb: { entries: number; associativity: number; pageSize: number }
  }
  prefetch: {
    activePolicy: string
    activeDegree: number
    l1Stream: boolean
    l1Stride: boolean
    l1Degree: number
    l2Stream: boolean
    l2Adjacent: boolean
    l2Degree: number
    l2Streams: number
    l2MaxDistance: number
    l3Prefetch: boolean
    pointerPrefetch: boolean
    dynamicDegree: boolean
  }
  executionCore: {
    model: string
    issueWidth: number
    robSize: number
    hideableCycles: number
    branchMispredictPenalty: number
    branchPredictor: string
    branchPredictorEntries: number
  }
  memory: {
    l1HitCycles: number
    l2HitCycles: number
    l3HitCycles: number
    dramCycles: number
    tlbMissPenaltyCycles: number
  }
  topology: {
    activeCores: number
    l1Scope: string
    l2Scope: string
    l3Scope: string
    coherence: string
  }
}

export interface PipelineBreakdown {
  baseCycles: number
  frontendStallCycles: number
  l2StallCycles: number
  l3StallCycles: number
  dramStallCycles: number
  branchStallCycles: number
  memoryStallCycles: number
}

export interface PipelineExecutionStats {
  instructions: number
  cycles: number
  ipc: number
  cpi: number
  breakdown: PipelineBreakdown
}

export interface HotBranch {
  file: string
  line: number
  total: number
  mispredictions: number
  mispredictionRate: number
}

export interface BranchPredictionStats {
  total: number
  correct: number
  mispredictions: number
  accuracy: number
  mispredictionRate: number
  hotBranches: HotBranch[]
}

export interface ExecutionStats {
  available: boolean
  model?: 'estimated'
  reason?: string
  pipeline?: PipelineExecutionStats
  branchPrediction?: BranchPredictionStats
}

export interface CacheResult {
  config: string
  profile?: HardwareProfile
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
  execution?: ExecutionStats
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
