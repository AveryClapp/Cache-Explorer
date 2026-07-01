import type { PrefetchPolicy } from '../types'

export interface ExperimentTemplate {
  id: string
  name: string
  description: string
  variants: string[]
  exampleKey?: string
  optLevel?: string
  prefetchPolicy?: PrefetchPolicy
  eventLimit?: number
  fastMode?: boolean
  cacheSegments?: boolean
  verifiedWorkloadId?: string
}

export const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    id: 'conv2d-tiling',
    name: 'Conv2D tiling',
    description: 'Direct convolution against tiled traversal',
    variants: ['direct', 'tiled:RUN_TILED=1'],
    exampleKey: 'conv2d_kernel',
    optLevel: '-O2',
    prefetchPolicy: 'adaptive',
    eventLimit: 1000000,
    fastMode: true,
    cacheSegments: true,
    verifiedWorkloadId: 'conv2d-intel14',
  },
  {
    id: 'matrix-blocking',
    name: 'Matrix blocking',
    description: 'Untiled and blocked matrix multiply',
    variants: ['untiled', 'blocked:RUN_BLOCKED=1'],
    exampleKey: 'blocking',
    optLevel: '-O2',
    prefetchPolicy: 'stream',
    eventLimit: 1000000,
    fastMode: true,
    cacheSegments: true,
  },
  {
    id: 'branch-predictor',
    name: 'Branch predictor',
    description: 'Predictable and alternating branch paths',
    variants: ['predictable', 'alternating:RUN_ALTERNATING=1'],
    exampleKey: 'branch_patterns',
    optLevel: '-O2',
    prefetchPolicy: 'none',
    eventLimit: 500000,
    fastMode: false,
    cacheSegments: false,
  },
]
