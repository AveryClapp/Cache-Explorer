const DEFAULT_TLB = {
  dtlb: { entries: 64, associativity: 4, pageSize: 4096 },
  itlb: { entries: 64, associativity: 4, pageSize: 4096 },
};

const DEFAULT_EXECUTION_CORE = {
  model: 'analytical-ooo',
  issueWidth: 4,
  robSize: 192,
  hideableCycles: 48,
  branchMispredictPenalty: 14,
  branchPredictor: 'bimodal-2bit',
  branchPredictorEntries: 1024,
  vectorBits: 256,
  vectorIsa: 'generic-vector',
  loadPorts: 2,
  storePorts: 1,
  integerPipelines: 4,
  fpPipelines: 2,
};

const EXECUTION_CORES = {
  educational: {
    ...DEFAULT_EXECUTION_CORE,
    issueWidth: 2,
    robSize: 64,
    hideableCycles: 32,
    vectorBits: 128,
    vectorIsa: 'teaching-model',
    loadPorts: 1,
    storePorts: 1,
    integerPipelines: 2,
    fpPipelines: 1,
  },
  intelClient: {
    ...DEFAULT_EXECUTION_CORE,
    vectorBits: 256,
    vectorIsa: 'avx2-class',
    loadPorts: 2,
    storePorts: 1,
    integerPipelines: 5,
    fpPipelines: 2,
  },
  intelServer: {
    ...DEFAULT_EXECUTION_CORE,
    issueWidth: 6,
    robSize: 320,
    hideableCycles: 53,
    vectorBits: 512,
    vectorIsa: 'avx-512-class',
    loadPorts: 3,
    storePorts: 2,
    integerPipelines: 5,
    fpPipelines: 2,
  },
  amdClient: {
    ...DEFAULT_EXECUTION_CORE,
    vectorBits: 256,
    vectorIsa: 'avx2-class',
    loadPorts: 3,
    storePorts: 2,
    integerPipelines: 4,
    fpPipelines: 2,
  },
  apple: {
    ...DEFAULT_EXECUTION_CORE,
    issueWidth: 8,
    robSize: 256,
    hideableCycles: 32,
    branchMispredictPenalty: 11,
    vectorBits: 128,
    vectorIsa: 'asimd/neon',
    loadPorts: 3,
    storePorts: 2,
    integerPipelines: 6,
    fpPipelines: 4,
  },
  armServer: {
    ...DEFAULT_EXECUTION_CORE,
    issueWidth: 5,
    robSize: 160,
    hideableCycles: 32,
    vectorBits: 128,
    vectorIsa: 'sve/neon-class',
    loadPorts: 2,
    storePorts: 1,
    integerPipelines: 4,
    fpPipelines: 2,
  },
  embedded: {
    ...DEFAULT_EXECUTION_CORE,
    issueWidth: 2,
    robSize: 48,
    hideableCycles: 24,
    branchMispredictPenalty: 8,
    vectorBits: 128,
    vectorIsa: 'neon-class',
    loadPorts: 1,
    storePorts: 1,
    integerPipelines: 2,
    fpPipelines: 1,
  },
};

const DEFAULT_MODEL_COVERAGE = {
  cacheHierarchy: 'modeled',
  tlb: 'modeled',
  prefetch: 'modeled',
  branchPrediction: 'estimated',
  executionCore: 'estimated',
  simd: 'metadata-only',
  bandwidth: 'metadata-only',
  coherence: 'modeled-for-multicore-traces',
  dependencyModel: 'not-modeled',
};

export const HARDWARE_MODEL_STATUSES = Object.freeze({
  calibrated: {
    label: 'Calibrated',
    description: 'Model behavior is backed by project-owned empirical validation for this profile or subsystem.',
  },
  modeled: {
    label: 'Modeled',
    description: 'The simulator consumes this field directly when computing results.',
  },
  estimated: {
    label: 'Estimated',
    description: 'The simulator consumes an approximate analytical model; use for directional comparisons.',
  },
  conditional: {
    label: 'Conditional',
    description: 'The simulator consumes this field only for matching traces or run modes.',
  },
  'metadata-only': {
    label: 'Metadata only',
    description: 'The field describes the profile but does not currently affect simulation results.',
  },
  unsupported: {
    label: 'Unsupported',
    description: 'The behavior is intentionally not modeled by the current engine.',
  },
});

const DEFAULT_MODEL_CONTRACT_FIELDS = Object.freeze({
  cacheHierarchy: {
    subsystem: 'cache',
    status: 'modeled',
    drivesSimulation: true,
    resultSurface: ['levels', 'hotLines', 'cacheState'],
    description: 'L1D, L1I, L2, L3 geometry, line size, associativity, inclusion, and write policy drive cache hit/miss simulation.',
  },
  cacheReplacement: {
    subsystem: 'cache',
    status: 'modeled',
    drivesSimulation: true,
    resultSurface: ['levels'],
    description: 'Replacement policy drives eviction behavior and 3C miss classification when detailed mode is enabled.',
  },
  cacheTiming: {
    subsystem: 'memory',
    status: 'estimated',
    drivesSimulation: true,
    resultSurface: ['timing', 'summary', 'execution.pipeline'],
    description: 'Per-level latency values drive timing totals and analytical pipeline stall estimates.',
    caveats: ['Latency values are architectural approximations unless a profile marks this field calibrated.'],
  },
  tlb: {
    subsystem: 'memory',
    status: 'modeled',
    drivesSimulation: true,
    resultSurface: ['tlb', 'timing'],
    description: 'DTLB and ITLB capacity, associativity, and page size drive TLB hit/miss accounting.',
  },
  prefetch: {
    subsystem: 'memory',
    status: 'modeled',
    drivesSimulation: true,
    resultSurface: ['prefetch', 'levels'],
    description: 'Configured next-line, stream, stride, adaptive, or Intel-style prefetch behavior can change cache contents and hit rates.',
    caveats: ['Vendor-specific prefetch policies are simplified and do not claim exact proprietary behavior.'],
  },
  coherence: {
    subsystem: 'coherence',
    status: 'conditional',
    drivesSimulation: true,
    resultSurface: ['coherence', 'falseSharing'],
    description: 'MESI-style invalidations and false-sharing reports are modeled for multicore traces.',
    caveats: ['Single-core runs report coherence as not applicable.'],
  },
  branchPrediction: {
    subsystem: 'execution',
    status: 'estimated',
    drivesSimulation: true,
    resultSurface: ['execution.branchPrediction', 'subsystems.execution', 'sourceAnnotations'],
    description: 'Branch events feed a bimodal two-bit predictor to estimate misprediction counts and branch stall cycles.',
    caveats: ['This is a transparent baseline predictor, not an exact Intel, AMD, Apple, or ARM predictor.'],
  },
  executionPipeline: {
    subsystem: 'execution',
    status: 'estimated',
    drivesSimulation: true,
    resultSurface: ['execution.pipeline', 'summary', 'sourceAnnotations'],
    description: 'Issue width, ROB size, branch penalty, and cache latencies feed an analytical out-of-order pipeline estimate.',
    caveats: ['The trace has no opcode mix, dependency graph, port pressure, SMT, or scheduler state; cycles are estimates, not measured runtime.'],
  },
  memoryBandwidth: {
    subsystem: 'memory',
    status: 'metadata-only',
    drivesSimulation: false,
    resultSurface: ['profile.details.memory'],
    description: 'Bandwidth fields describe the profile and exports but do not currently affect cache or timing results.',
  },
  memoryLevelParallelism: {
    subsystem: 'memory',
    status: 'metadata-only',
    drivesSimulation: false,
    resultSurface: ['profile.details.memory'],
    description: 'MLP fields describe the profile; current exposed-latency estimates use ROB-derived hiding instead.',
  },
  simd: {
    subsystem: 'execution',
    status: 'metadata-only',
    drivesSimulation: false,
    resultSurface: ['profile.details.executionCore', 'advancedStats.vector'],
    description: 'Vector width and ISA labels describe profile capability; vector trace stats are reported but not scheduled against SIMD width.',
  },
  topology: {
    subsystem: 'topology',
    status: 'metadata-only',
    drivesSimulation: false,
    resultSurface: ['profile.details.topology'],
    description: 'Profile topology labels describe cache sharing scope; runtime core count still controls whether multicore simulation is used.',
  },
  dependencyModel: {
    subsystem: 'execution',
    status: 'unsupported',
    drivesSimulation: false,
    resultSurface: [],
    description: 'Instruction dependencies, port pressure, reorder scheduling, SMT, and exact frontend/decode behavior are not modeled.',
  },
  numa: {
    subsystem: 'topology',
    status: 'unsupported',
    drivesSimulation: false,
    resultSurface: [],
    description: 'NUMA domains, sockets, remote memory latency, and inter-socket traffic are not modeled.',
  },
});

export const HARDWARE_MODEL_FIELD_IDS = Object.freeze(Object.keys(DEFAULT_MODEL_CONTRACT_FIELDS));

const LEGACY_COVERAGE_KEYS = Object.freeze({
  cacheHierarchy: 'cacheHierarchy',
  tlb: 'tlb',
  prefetch: 'prefetch',
  branchPrediction: 'branchPrediction',
  executionPipeline: 'executionCore',
  simd: 'simd',
  memoryBandwidth: 'bandwidth',
  coherence: 'coherence',
  dependencyModel: 'dependencyModel',
});

function modelContractField(field, override = {}) {
  return {
    ...field,
    ...override,
    caveats: [
      ...(field.caveats || []),
      ...(override.caveats || []),
    ],
  };
}

function buildModelContract(fieldOverrides = {}) {
  const fields = {};
  for (const fieldId of HARDWARE_MODEL_FIELD_IDS) {
    fields[fieldId] = modelContractField(
      DEFAULT_MODEL_CONTRACT_FIELDS[fieldId],
      fieldOverrides[fieldId],
    );
  }

  return {
    version: 1,
    statusTerms: HARDWARE_MODEL_STATUSES,
    fields,
  };
}

function modelCoverageFromContract(contract) {
  const coverage = {};
  for (const [contractKey, legacyKey] of Object.entries(LEGACY_COVERAGE_KEYS)) {
    coverage[legacyKey] = contract.fields[contractKey].status;
  }
  return coverage;
}

const LATENCIES = {
  default: {
    l1HitCycles: 4,
    l2HitCycles: 12,
    l3HitCycles: 40,
    dramCycles: 200,
    tlbMissPenaltyCycles: 7,
    l1BandwidthBytesPerCycle: 64,
    l2BandwidthBytesPerCycle: 32,
    l3BandwidthBytesPerCycle: 16,
    dramBandwidthGBs: 80,
    maxMemoryLevelParallelism: 8,
  },
  intel: {
    l1HitCycles: 5,
    l2HitCycles: 14,
    l3HitCycles: 50,
    dramCycles: 200,
    tlbMissPenaltyCycles: 7,
    l1BandwidthBytesPerCycle: 96,
    l2BandwidthBytesPerCycle: 64,
    l3BandwidthBytesPerCycle: 32,
    dramBandwidthGBs: 90,
    maxMemoryLevelParallelism: 10,
  },
  amd: {
    l1HitCycles: 4,
    l2HitCycles: 14,
    l3HitCycles: 46,
    dramCycles: 190,
    tlbMissPenaltyCycles: 8,
    l1BandwidthBytesPerCycle: 96,
    l2BandwidthBytesPerCycle: 64,
    l3BandwidthBytesPerCycle: 32,
    dramBandwidthGBs: 95,
    maxMemoryLevelParallelism: 10,
  },
  apple: {
    l1HitCycles: 3,
    l2HitCycles: 15,
    l3HitCycles: 0,
    dramCycles: 100,
    tlbMissPenaltyCycles: 5,
    l1BandwidthBytesPerCycle: 128,
    l2BandwidthBytesPerCycle: 64,
    l3BandwidthBytesPerCycle: 32,
    dramBandwidthGBs: 200,
    maxMemoryLevelParallelism: 12,
  },
  educational: {
    l1HitCycles: 1,
    l2HitCycles: 10,
    l3HitCycles: 30,
    dramCycles: 100,
    tlbMissPenaltyCycles: 10,
    l1BandwidthBytesPerCycle: 16,
    l2BandwidthBytesPerCycle: 8,
    l3BandwidthBytesPerCycle: 4,
    dramBandwidthGBs: 20,
    maxMemoryLevelParallelism: 2,
  },
};

const PREFETCH = {
  none: {
    activePolicy: 'none',
    activeDegree: 0,
    l1Stream: false,
    l1Stride: false,
    l1Degree: 0,
    l2Stream: false,
    l2Adjacent: false,
    l2Degree: 0,
    l2Streams: 0,
    l2MaxDistance: 0,
    l3Prefetch: false,
    pointerPrefetch: false,
    dynamicDegree: false,
  },
  intel: {
    activePolicy: 'adaptive',
    activeDegree: 4,
    l1Stream: true,
    l1Stride: true,
    l1Degree: 2,
    l2Stream: true,
    l2Adjacent: true,
    l2Degree: 4,
    l2Streams: 32,
    l2MaxDistance: 4,
    l3Prefetch: true,
    pointerPrefetch: false,
    dynamicDegree: true,
  },
  amd: {
    activePolicy: 'adaptive',
    activeDegree: 4,
    l1Stream: true,
    l1Stride: true,
    l1Degree: 2,
    l2Stream: true,
    l2Adjacent: false,
    l2Degree: 4,
    l2Streams: 16,
    l2MaxDistance: 4,
    l3Prefetch: false,
    pointerPrefetch: false,
    dynamicDegree: false,
  },
  apple: {
    activePolicy: 'adaptive',
    activeDegree: 4,
    l1Stream: true,
    l1Stride: true,
    l1Degree: 2,
    l2Stream: true,
    l2Adjacent: false,
    l2Degree: 4,
    l2Streams: 16,
    l2MaxDistance: 4,
    l3Prefetch: true,
    pointerPrefetch: true,
    dynamicDegree: false,
  },
  arm: {
    activePolicy: 'adaptive',
    activeDegree: 4,
    l1Stream: true,
    l1Stride: true,
    l1Degree: 2,
    l2Stream: true,
    l2Adjacent: false,
    l2Degree: 4,
    l2Streams: 8,
    l2MaxDistance: 4,
    l3Prefetch: true,
    pointerPrefetch: false,
    dynamicDegree: false,
  },
};

function cacheLevel(sizeKB, associativity, replacement, writePolicy = 'write-back', lineSize = 64) {
  const sets = sizeKB > 0 ? Math.floor((sizeKB * 1024) / (lineSize * associativity)) : 0;
  return { sizeKB, associativity, lineSize, sets, replacement, writePolicy };
}

function topology(levels, activeCores = 1) {
  return {
    activeCores,
    l1Scope: 'private-per-core',
    l2Scope: activeCores > 1 ? 'shared-across-modeled-cores' : 'private-to-modeled-core',
    l3Scope: levels.l3.sizeKB > 0 ? 'shared-last-level' : 'none',
    coherence: activeCores > 1 ? 'mesi' : 'not-applicable',
  };
}

function profile({
  id,
  aliases = [],
  displayName,
  vendor,
  architecture,
  profileClass,
  modelConfidence,
  inclusion,
  levels,
  prefetch,
  latency,
  executionCore = DEFAULT_EXECUTION_CORE,
  modelCoverage = DEFAULT_MODEL_COVERAGE,
  validation,
  notes,
  modelContract,
}) {
  const resolvedModelContract = buildModelContract(modelContract);
  return {
    id,
    aliases,
    displayName,
    vendor,
    architecture,
    class: profileClass,
    modelConfidence,
    modelCoverage: {
      ...modelCoverageFromContract(resolvedModelContract),
      ...modelCoverage,
    },
    modelContract: resolvedModelContract,
    validation: validation || {
      source: 'architecture references and simulator presets',
      confidence: modelConfidence,
      caveats: ['Execution, SIMD, bandwidth, and dependency behavior are modeled as estimates unless marked calibrated.'],
    },
    notes,
    details: {
      cache: {
        inclusion,
        levels,
      },
      tlb: DEFAULT_TLB,
      prefetch,
      executionCore,
      memory: latency,
      topology: topology(levels),
    },
  };
}

export const HARDWARE_PROFILES = [
  profile({
    id: 'educational',
    displayName: 'Educational',
    vendor: 'Learning',
    architecture: 'teaching-model',
    profileClass: 'learning',
    modelConfidence: 'educational',
    inclusion: 'inclusive',
    levels: {
      l1d: cacheLevel(1, 2, 'lru'),
      l1i: cacheLevel(1, 2, 'lru', 'read-only'),
      l2: cacheLevel(4, 4, 'lru'),
      l3: cacheLevel(16, 8, 'lru'),
    },
    prefetch: PREFETCH.none,
    latency: LATENCIES.educational,
    executionCore: EXECUTION_CORES.educational,
    modelCoverage: {
      ...DEFAULT_MODEL_COVERAGE,
      branchPrediction: 'teaching-estimate',
      executionCore: 'teaching-estimate',
      simd: 'metadata-only',
      bandwidth: 'teaching-estimate',
    },
    modelContract: {
      branchPrediction: {
        status: 'estimated',
        caveats: ['Teaching profile keeps the predictor deliberately simple and inspectable.'],
      },
      executionPipeline: {
        status: 'estimated',
        caveats: ['Teaching profile favors clear directional behavior over real CPU fidelity.'],
      },
      memoryBandwidth: {
        status: 'metadata-only',
        caveats: ['Bandwidth is displayed as teaching context and does not currently drive simulation.'],
      },
    },
    notes: 'Tiny caches and no prefetching for easy-to-see misses.',
  }),
  profile({
    id: 'intel',
    aliases: ['intel12'],
    displayName: 'Intel 12th Gen',
    vendor: 'Intel',
    architecture: 'x86_64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(32, 8, 'pseudo-lru'),
      l1i: cacheLevel(32, 8, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(1024, 8, 'pseudo-lru'),
      l3: cacheLevel(32768, 16, 'pseudo-lru'),
    },
    prefetch: PREFETCH.intel,
    latency: LATENCIES.intel,
    executionCore: EXECUTION_CORES.intelClient,
  }),
  profile({
    id: 'intel14',
    displayName: 'Intel 14th Gen',
    vendor: 'Intel',
    architecture: 'x86_64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(48, 12, 'pseudo-lru'),
      l1i: cacheLevel(32, 8, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(2048, 16, 'pseudo-lru'),
      l3: cacheLevel(36864, 18, 'pseudo-lru'),
    },
    prefetch: PREFETCH.intel,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.intelClient,
  }),
  profile({
    id: 'xeon',
    displayName: 'Intel Xeon',
    vendor: 'Intel',
    architecture: 'x86_64',
    profileClass: 'server',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(48, 12, 'pseudo-lru'),
      l1i: cacheLevel(32, 8, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(1280, 20, 'pseudo-lru'),
      l3: cacheLevel(49152, 12, 'pseudo-lru'),
    },
    prefetch: PREFETCH.intel,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.intelServer,
  }),
  profile({
    id: 'xeon8488c',
    aliases: ['sapphire'],
    displayName: 'Intel Xeon Platinum 8488C',
    vendor: 'Intel',
    architecture: 'x86_64',
    profileClass: 'server',
    modelConfidence: 'calibrated',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(48, 12, 'pseudo-lru'),
      l1i: cacheLevel(32, 8, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(2048, 16, 'pseudo-lru'),
      l3: cacheLevel(98304, 12, 'pseudo-lru'),
    },
    prefetch: PREFETCH.intel,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.intelServer,
    validation: {
      source: 'measured cache topology with simulator-normalized LLC geometry',
      confidence: 'calibrated',
      caveats: ['LLC associativity is adjusted to keep simulator set counts power-of-two.'],
    },
    modelContract: {
      cacheHierarchy: {
        status: 'calibrated',
        caveats: ['L1/L2 cache behavior has a saved perf validation baseline; LLC geometry is simulator-normalized.'],
      },
      cacheReplacement: {
        status: 'modeled',
        caveats: ['Replacement policy remains a simulator approximation, not a measured hardware replacement algorithm.'],
      },
      cacheTiming: {
        status: 'estimated',
        caveats: ['Latency values are directional; the validation baseline is cache-counter focused, not cycle focused.'],
      },
    },
    notes: 'L3 is adjusted from the real 105 MB / 15-way shape to simulator-compatible power-of-two sets.',
  }),
  profile({
    id: 'amd',
    aliases: ['zen4'],
    displayName: 'AMD Zen 4',
    vendor: 'AMD',
    architecture: 'x86_64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'exclusive',
    levels: {
      l1d: cacheLevel(32, 8, 'lru'),
      l1i: cacheLevel(32, 8, 'lru', 'read-only'),
      l2: cacheLevel(1024, 8, 'lru'),
      l3: cacheLevel(32768, 16, 'pseudo-lru'),
    },
    prefetch: PREFETCH.amd,
    latency: LATENCIES.amd,
    executionCore: EXECUTION_CORES.amdClient,
  }),
  profile({
    id: 'zen3',
    displayName: 'AMD Zen 3',
    vendor: 'AMD',
    architecture: 'x86_64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'exclusive',
    levels: {
      l1d: cacheLevel(32, 8, 'lru'),
      l1i: cacheLevel(32, 8, 'lru', 'read-only'),
      l2: cacheLevel(512, 8, 'lru'),
      l3: cacheLevel(32768, 16, 'lru'),
    },
    prefetch: PREFETCH.amd,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.amdClient,
  }),
  profile({
    id: 'epyc',
    displayName: 'AMD EPYC',
    vendor: 'AMD',
    architecture: 'x86_64',
    profileClass: 'server',
    modelConfidence: 'directional',
    inclusion: 'exclusive',
    levels: {
      l1d: cacheLevel(32, 8, 'lru'),
      l1i: cacheLevel(32, 8, 'lru', 'read-only'),
      l2: cacheLevel(512, 8, 'lru'),
      l3: cacheLevel(262144, 16, 'lru'),
    },
    prefetch: PREFETCH.amd,
    latency: LATENCIES.default,
    executionCore: {
      ...EXECUTION_CORES.amdClient,
      issueWidth: 6,
      robSize: 320,
      hideableCycles: 53,
    },
  }),
  profile({
    id: 'apple',
    aliases: ['m1'],
    displayName: 'Apple M1',
    vendor: 'Apple',
    architecture: 'arm64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(64, 8, 'pseudo-lru'),
      l1i: cacheLevel(128, 8, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(4096, 16, 'pseudo-lru'),
      l3: cacheLevel(32768, 16, 'pseudo-lru'),
    },
    prefetch: PREFETCH.apple,
    latency: LATENCIES.apple,
    executionCore: EXECUTION_CORES.apple,
  }),
  profile({
    id: 'm2',
    displayName: 'Apple M2',
    vendor: 'Apple',
    architecture: 'arm64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(128, 8, 'pseudo-lru'),
      l1i: cacheLevel(192, 6, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(16384, 16, 'pseudo-lru'),
      l3: cacheLevel(24576, 12, 'pseudo-lru'),
    },
    prefetch: PREFETCH.apple,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.apple,
  }),
  profile({
    id: 'm3',
    displayName: 'Apple M3',
    vendor: 'Apple',
    architecture: 'arm64',
    profileClass: 'client',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(128, 8, 'pseudo-lru'),
      l1i: cacheLevel(192, 6, 'pseudo-lru', 'read-only'),
      l2: cacheLevel(32768, 16, 'pseudo-lru'),
      l3: cacheLevel(32768, 16, 'pseudo-lru'),
    },
    prefetch: PREFETCH.apple,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.apple,
  }),
  profile({
    id: 'graviton',
    aliases: ['graviton3'],
    displayName: 'AWS Graviton 3',
    vendor: 'ARM',
    architecture: 'arm64',
    profileClass: 'cloud',
    modelConfidence: 'directional',
    inclusion: 'non-inclusive-non-exclusive',
    levels: {
      l1d: cacheLevel(64, 4, 'lru'),
      l1i: cacheLevel(64, 4, 'lru', 'read-only'),
      l2: cacheLevel(1024, 8, 'lru'),
      l3: cacheLevel(32768, 16, 'lru'),
    },
    prefetch: PREFETCH.arm,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.armServer,
  }),
  profile({
    id: 'embedded',
    displayName: 'Embedded ARM',
    vendor: 'ARM',
    architecture: 'arm64',
    profileClass: 'embedded',
    modelConfidence: 'educational',
    inclusion: 'inclusive',
    levels: {
      l1d: cacheLevel(32, 4, 'lru'),
      l1i: cacheLevel(32, 2, 'lru', 'read-only'),
      l2: cacheLevel(512, 8, 'lru'),
      l3: cacheLevel(0, 1, 'lru'),
    },
    prefetch: PREFETCH.none,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.embedded,
  }),
  profile({
    id: 'rpi4',
    aliases: ['raspberry'],
    displayName: 'Raspberry Pi 4',
    vendor: 'ARM',
    architecture: 'arm64',
    profileClass: 'embedded',
    modelConfidence: 'directional',
    inclusion: 'inclusive',
    levels: {
      l1d: cacheLevel(32, 2, 'lru'),
      l1i: cacheLevel(48, 3, 'lru', 'read-only'),
      l2: cacheLevel(1024, 16, 'lru'),
      l3: cacheLevel(0, 1, 'lru'),
    },
    prefetch: PREFETCH.arm,
    latency: LATENCIES.default,
    executionCore: EXECUTION_CORES.embedded,
  }),
];

const HARDWARE_PROFILE_INDEX = new Map();
for (const profileEntry of HARDWARE_PROFILES) {
  HARDWARE_PROFILE_INDEX.set(profileEntry.id, profileEntry);
  for (const alias of profileEntry.aliases) {
    HARDWARE_PROFILE_INDEX.set(alias, profileEntry);
  }
}

export function listHardwareProfiles() {
  return HARDWARE_PROFILES;
}

export function getHardwareProfile(id) {
  return HARDWARE_PROFILE_INDEX.get(id);
}
