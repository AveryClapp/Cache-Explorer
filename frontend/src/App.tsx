import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'
import LZString from 'lz-string'
import './App.css'

// Import visualization components
import { FileManager } from './components'
import type { ProjectFile } from './components'

// API base URL - in production (Docker), use relative paths; in dev, use localhost
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

interface Compiler {
  id: string
  name: string
  version: string
  major: number
  path: string
  source: string
  default?: boolean
}

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
  // 3C miss classification (only available when fast mode is disabled)
  compulsory?: number  // Cold misses - first access ever
  capacity?: number    // Working set exceeds cache size
  conflict?: number    // Limited associativity caused eviction
}

interface HotLine {
  file: string
  line: number
  hits: number
  misses: number
  missRate: number
  threads?: number
}

interface FalseSharingAccess {
  threadId: number
  offset: number
  isWrite: boolean
  file: string
  line: number
  count: number
}

interface FalseSharingEvent {
  cacheLineAddr: string
  accessCount: number
  accesses: FalseSharingAccess[]
}

interface CoherenceStats {
  invalidations: number
  falseSharingEvents: number
}

interface CompileError {
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
  notes?: string[]
  sourceLine?: string
  caret?: string
}

interface ErrorResult {
  type: 'compile_error' | 'linker_error' | 'runtime_error' | 'timeout' | 'unknown_error' | 'validation_error' | 'server_error'
  errors?: CompileError[]
  summary?: string
  message?: string
  suggestion?: string
  raw?: string
  error?: string
}

interface OptimizationSuggestion {
  type: string
  severity: 'high' | 'medium' | 'low'
  location: string
  message: string
  fix: string
}

interface CacheLevelConfig {
  sizeKB: number
  assoc: number
  lineSize: number
  sets: number
}

interface CacheConfig {
  l1d: CacheLevelConfig
  l1i: CacheLevelConfig
  l2: CacheLevelConfig
  l3: CacheLevelConfig
}

interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
}

// Advanced instrumentation stats
interface SoftwarePrefetchStats {
  issued: number
  useful: number
  accuracy: number
}

interface VectorStats {
  loads: number
  stores: number
  bytesLoaded: number
  bytesStored: number
  crossLineAccesses: number
}

interface AtomicStats {
  loads: number
  stores: number
  rmw: number
  cmpxchg: number
}

interface MemoryIntrinsicStats {
  memcpyCount: number
  memcpyBytes: number
  memsetCount: number
  memsetBytes: number
  memmoveCount: number
  memmoveBytes: number
}

interface AdvancedStats {
  softwarePrefetch?: SoftwarePrefetchStats
  vector?: VectorStats
  atomic?: AtomicStats
  memoryIntrinsics?: MemoryIntrinsicStats
}

interface CacheLineState {
  s: number      // set
  w: number      // way
  v: number      // valid (0 or 1)
  t?: string     // tag (hex string)
  st?: string    // state: M, E, S, I
}

interface CoreCacheState {
  core: number
  sets: number
  ways: number
  lines: CacheLineState[]
}

interface CacheState {
  l1d: CoreCacheState[]
}

interface TLBHierarchyStats {
  dtlb: { hits: number; misses: number; hitRate: number }
  itlb: { hits: number; misses: number; hitRate: number }
}

interface TimingBreakdown {
  l1HitCycles: number
  l2HitCycles: number
  l3HitCycles: number
  memoryCycles: number
  tlbMissCycles: number
}

interface LatencyConfig {
  l1Hit: number
  l2Hit: number
  l3Hit: number
  memory: number
  tlbMissPenalty: number
}

interface TimingStats {
  totalCycles: number
  avgLatency: number
  breakdown: TimingBreakdown
  latencyConfig: LatencyConfig
}

interface CacheResult {
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

type Language = 'c' | 'cpp' | 'rust'

interface FileTab {
  id: string
  name: string
  code: string
  language: Language
  isMain?: boolean
}

interface ExampleFile {
  name: string
  code: string
  language: Language
  isMain?: boolean
}

interface Example {
  name: string
  code: string
  description: string
  language: Language
  files?: ExampleFile[]  // Optional multi-file support
}

const EXAMPLES: Record<string, Example> = {
  // === Access Patterns ===
  sequential: {
    name: 'Sequential Access',
    description: 'Best case - spatial locality',
    language: 'c',
    code: `// Sequential array access - good cache behavior
#include <stdio.h>
#define N 1000

int main() {
    int arr[N];
    int sum = 0;

    for (int i = 0; i < N; i++) arr[i] = i;
    for (int i = 0; i < N; i++) sum += arr[i];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  strided: {
    name: 'Strided Access',
    description: 'Skips cache lines - poor locality',
    language: 'c',
    code: `// Strided access - poor cache behavior
#include <stdio.h>
#define N 1000
#define STRIDE 16  // 64 bytes = 1 cache line

int main() {
    int arr[N * STRIDE];
    for (int i = 0; i < N * STRIDE; i++) arr[i] = i;

    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i * STRIDE];  // Miss every access

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  matrix_row: {
    name: 'Row-Major Matrix',
    description: 'Sequential memory access - cache friendly',
    language: 'c',
    code: `// Row-major matrix traversal - good cache behavior
#include <stdio.h>
#define N 64

int main() {
    int matrix[N][N];
    int sum = 0;

    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            matrix[i][j] = i + j;

    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += matrix[i][j];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  matrix_col: {
    name: 'Column-Major Matrix',
    description: 'Strided access - cache unfriendly',
    language: 'c',
    code: `// Column-major matrix traversal - poor cache behavior
#include <stdio.h>
#define N 64

int main() {
    int matrix[N][N];
    int sum = 0;

    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            matrix[i][j] = i + j;

    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            sum += matrix[i][j];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  linkedlist: {
    name: 'Linked List',
    description: 'Pointer chasing - poor locality',
    language: 'c',
    code: `// Linked List - scattered memory access
#include <stdio.h>
#include <stdlib.h>
#define N 10000

struct Node { int value; struct Node* next; };

int main() {
    struct Node* head = NULL;
    for (int i = 0; i < N; i++) {
        struct Node* node = malloc(sizeof(struct Node));
        node->value = i;
        node->next = head;
        head = node;
    }

    int sum = 0;
    for (int rep = 0; rep < 10; rep++) {
        struct Node* curr = head;
        while (curr) {
            sum += curr->value;
            curr = curr->next;
        }
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  binary_search: {
    name: 'Binary Search',
    description: 'Unpredictable memory access pattern',
    language: 'c',
    code: `// Binary Search - random-like access pattern
#include <stdio.h>
#define N 1000000

int arr[N];

int binary_search(int target) {
    int left = 0, right = N - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}

int main() {
    for (int i = 0; i < N; i++) arr[i] = i * 2;

    int found = 0;
    for (int i = 0; i < 10000; i++) {
        int target = (i * 7) % (N * 2);
        if (binary_search(target) >= 0) found++;
    }

    printf("Found: %d\\n", found);
    return 0;
}
`
  },

  // === Data Layout ===
  array_of_structs: {
    name: 'Array of Structs',
    description: 'AoS - wastes cache on partial field access',
    language: 'c',
    code: `// Array of Structs (AoS) - Mixed Locality
#include <stdio.h>
#define N 10000

struct Particle {
    float x, y, z;
    float vx, vy, vz;
    float mass;
    int id;
};  // 32 bytes

struct Particle particles[N];

int main() {
    for (int i = 0; i < N; i++) {
        particles[i].x = i * 0.1f;
        particles[i].y = i * 0.2f;
        particles[i].mass = 1.0f;
    }

    // Access ONLY x - wastes cache loading other fields
    float sum_x = 0;
    for (int rep = 0; rep < 100; rep++)
        for (int i = 0; i < N; i++)
            sum_x += particles[i].x;

    printf("Sum: %f\\n", sum_x);
    return 0;
}
`
  },
  struct_of_arrays: {
    name: 'Struct of Arrays',
    description: 'SoA - excellent locality for single field',
    language: 'c',
    code: `// Struct of Arrays (SoA) - Excellent Locality
#include <stdio.h>
#define N 10000

struct Particles {
    float x[N], y[N], z[N];
    float vx[N], vy[N], vz[N];
    float mass[N];
    int id[N];
};

struct Particles p;

int main() {
    for (int i = 0; i < N; i++) {
        p.x[i] = i * 0.1f;
        p.y[i] = i * 0.2f;
        p.mass[i] = 1.0f;
    }

    // Access ONLY x - perfect sequential access
    float sum_x = 0;
    for (int rep = 0; rep < 100; rep++)
        for (int i = 0; i < N; i++)
            sum_x += p.x[i];

    printf("Sum: %f\\n", sum_x);
    return 0;
}
`
  },

  // === Optimizations ===
  blocking: {
    name: 'Cache Blocking',
    description: 'Tiled matrix multiply',
    language: 'c',
    code: `// Cache Blocking - Matrix Multiply Optimization
#include <stdio.h>
#define N 256
#define BLOCK 32

float A[N][N], B[N][N], C[N][N];

int main() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            A[i][j] = i + j;
            B[i][j] = i - j;
            C[i][j] = 0;
        }

    // Blocked multiply - better cache reuse
    for (int i = 0; i < N; i += BLOCK)
        for (int j = 0; j < N; j += BLOCK)
            for (int k = 0; k < N; k += BLOCK)
                for (int ii = i; ii < i + BLOCK; ii++)
                    for (int jj = j; jj < j + BLOCK; jj++) {
                        float sum = C[ii][jj];
                        for (int kk = k; kk < k + BLOCK; kk++)
                            sum += A[ii][kk] * B[kk][jj];
                        C[ii][jj] = sum;
                    }

    float sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += C[i][j];

    printf("Checksum: %f\\n", sum);
    return 0;
}
`
  },
  loop_interchange: {
    name: 'Loop Interchange',
    description: 'Fix column-major to row-major',
    language: 'c',
    code: `// Loop Interchange - Fixing Column-Major Access
#include <stdio.h>
#define N 512

int matrix[N][N];

// BAD: Column-major access
void fill_column_major() {
    for (int j = 0; j < N; j++)
        for (int i = 0; i < N; i++)
            matrix[i][j] = i + j;
}

// GOOD: Row-major access
void fill_row_major() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            matrix[i][j] = i + j;
}

int main() {
    fill_row_major();  // Try fill_column_major() to compare

    int sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += matrix[i][j];

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  loop_fusion: {
    name: 'Loop Fusion',
    description: 'Combine loops for better cache use',
    language: 'c',
    code: `// Loop Fusion - Combining Loops
#include <stdio.h>
#define N 100000

float a[N], b[N], c[N], d[N];

// GOOD: Fused loop - load a[i] once
void fused_loop() {
    for (int i = 0; i < N; i++) {
        float val = a[i];
        b[i] = val * 2;
        c[i] = val + 1;
        d[i] = val - 1;
    }
}

int main() {
    for (int i = 0; i < N; i++) a[i] = (float)i;

    fused_loop();

    float sum = 0;
    for (int i = 0; i < N; i++)
        sum += b[i] + c[i] + d[i];

    printf("Sum: %f\\n", sum);
    return 0;
}
`
  },
  prefetch_friendly: {
    name: 'Prefetch Friendly',
    description: 'Sequential access - prefetcher excels',
    language: 'c',
    code: `// Prefetch-Friendly Access Pattern
#include <stdio.h>
#define N 1000000

int data[N];

int main() {
    for (int i = 0; i < N; i++) data[i] = i;

    // Sequential scan - prefetcher predicts this
    long long sum = 0;
    for (int rep = 0; rep < 5; rep++)
        for (int i = 0; i < N; i++)
            sum += data[i];

    printf("Sum: %lld\\n", sum);
    return 0;
}
`
  },

  // === Anti-patterns ===
  prefetch_unfriendly: {
    name: 'Prefetch Unfriendly',
    description: 'Random access defeats prefetcher',
    language: 'c',
    code: `// Prefetch-Unfriendly - Random Access
#include <stdio.h>
#define N 100000

int data[N];
int indices[N];

int main() {
    unsigned int seed = 42;
    for (int i = 0; i < N; i++) {
        indices[i] = i;
        data[i] = i;
    }

    // Shuffle indices
    for (int i = N - 1; i > 0; i--) {
        seed = seed * 1103515245 + 12345;
        int j = (seed >> 16) % (i + 1);
        int tmp = indices[i];
        indices[i] = indices[j];
        indices[j] = tmp;
    }

    // Random access - unpredictable
    long long sum = 0;
    for (int rep = 0; rep < 5; rep++)
        for (int i = 0; i < N; i++)
            sum += data[indices[i]];

    printf("Sum: %lld\\n", sum);
    return 0;
}
`
  },
  false_sharing: {
    name: 'False Sharing',
    description: 'Multi-threaded cache contention',
    language: 'c',
    code: `// False Sharing - Cache Line Ping-Pong
#include <stdio.h>
#include <pthread.h>
#define ITERATIONS 1000000

// BAD: Both counters on same cache line
struct {
    int counter1;
    int counter2;
} shared_bad;

void* increment1(void* arg) {
    for (int i = 0; i < ITERATIONS; i++)
        shared_bad.counter1++;
    return NULL;
}

void* increment2(void* arg) {
    for (int i = 0; i < ITERATIONS; i++)
        shared_bad.counter2++;
    return NULL;
}

int main() {
    pthread_t t1, t2;
    pthread_create(&t1, NULL, increment1, NULL);
    pthread_create(&t2, NULL, increment2, NULL);
    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    printf("C1: %d, C2: %d\\n", shared_bad.counter1, shared_bad.counter2);
    return 0;
}
`
  },

  // === Working Set ===
  working_set_small: {
    name: 'Small Working Set',
    description: 'Fits in L1 cache - high hit rate',
    language: 'c',
    code: `// Small Working Set - Fits in L1 Cache
#include <stdio.h>
#define SIZE (16 * 1024 / sizeof(int))  // 16KB

int data[SIZE];

int main() {
    for (int i = 0; i < SIZE; i++) data[i] = i;

    // Repeatedly access same data - stays in L1
    long long sum = 0;
    for (int rep = 0; rep < 1000; rep++)
        for (int i = 0; i < SIZE; i++)
            sum += data[i];

    printf("Sum: %lld\\n", sum);
    return 0;
}
`
  },
  working_set_large: {
    name: 'Large Working Set',
    description: 'Exceeds L3 cache - capacity misses',
    language: 'c',
    code: `// Large Working Set - Exceeds L3 Cache
#include <stdio.h>
#define SIZE (16 * 1024 * 1024 / sizeof(int))  // 16MB

int data[SIZE];

int main() {
    for (int i = 0; i < SIZE; i++) data[i] = i;

    // Access large dataset - constant capacity misses
    long long sum = 0;
    for (int rep = 0; rep < 3; rep++)
        for (int i = 0; i < SIZE; i++)
            sum += data[i];

    printf("Sum: %lld\\n", sum);
    return 0;
}
`
  },
  memory_pool: {
    name: 'Memory Pool',
    description: 'Cache-friendly allocation',
    language: 'c',
    code: `// Memory Pool - Contiguous Allocation
#include <stdio.h>
#define POOL_SIZE 10000

struct Object {
    int data[4];
    struct Object* next;
};

struct Object pool[POOL_SIZE];
int pool_index = 0;

struct Object* pool_alloc() {
    if (pool_index < POOL_SIZE)
        return &pool[pool_index++];
    return 0;
}

int main() {
    struct Object* head = 0;
    for (int i = 0; i < POOL_SIZE; i++) {
        struct Object* obj = pool_alloc();
        if (obj) {
            obj->data[0] = i;
            obj->next = head;
            head = obj;
        }
    }

    int sum = 0;
    for (int rep = 0; rep < 100; rep++) {
        struct Object* curr = head;
        while (curr) {
            sum += curr->data[0];
            curr = curr->next;
        }
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },

  // === Algorithms ===
  quicksort: {
    name: 'Quicksort',
    description: 'Divide and conquer - good cache behavior',
    language: 'c',
    code: `// Quicksort - Good Cache Behavior
#include <stdio.h>
#define N 10000

int arr[N];

void swap(int* a, int* b) { int t = *a; *a = *b; *b = t; }

int partition(int low, int high) {
    int pivot = arr[high], i = low - 1;
    for (int j = low; j < high; j++)
        if (arr[j] <= pivot) swap(&arr[++i], &arr[j]);
    swap(&arr[i + 1], &arr[high]);
    return i + 1;
}

void quicksort(int low, int high) {
    if (low < high) {
        int pi = partition(low, high);
        quicksort(low, pi - 1);
        quicksort(pi + 1, high);
    }
}

int main() {
    for (int i = 0; i < N; i++) arr[i] = N - i;
    quicksort(0, N - 1);

    int sorted = 1;
    for (int i = 1; i < N; i++)
        if (arr[i] < arr[i-1]) sorted = 0;

    printf("Sorted: %s\\n", sorted ? "yes" : "no");
    return 0;
}
`
  },
  hash_table: {
    name: 'Hash Table',
    description: 'Random access pattern',
    language: 'c',
    code: `// Hash Table - Random Access Pattern
#include <stdio.h>
#include <string.h>
#define TABLE_SIZE 10007
#define NUM_LOOKUPS 100000

struct Entry { int key, value, occupied; };
struct Entry table[TABLE_SIZE];

int hash(int key) {
    return ((key * 2654435761U) >> 16) % TABLE_SIZE;
}

void insert(int key, int value) {
    int idx = hash(key);
    while (table[idx].occupied && table[idx].key != key)
        idx = (idx + 1) % TABLE_SIZE;
    table[idx].key = key;
    table[idx].value = value;
    table[idx].occupied = 1;
}

int lookup(int key) {
    int idx = hash(key);
    while (table[idx].occupied) {
        if (table[idx].key == key) return table[idx].value;
        idx = (idx + 1) % TABLE_SIZE;
    }
    return -1;
}

int main() {
    memset(table, 0, sizeof(table));
    for (int i = 0; i < 5000; i++) insert(i * 7, i);

    int sum = 0;
    for (int i = 0; i < NUM_LOOKUPS; i++) {
        int val = lookup((i * 13) % 5000 * 7);
        if (val >= 0) sum += val;
    }

    printf("Sum: %d\\n", sum);
    return 0;
}
`
  },
  image_blur: {
    name: 'Image Blur',
    description: '2D stencil access pattern',
    language: 'c',
    code: `// Image Blur - 2D Stencil Pattern
#include <stdio.h>
#define WIDTH 512
#define HEIGHT 512

unsigned char input[HEIGHT][WIDTH];
unsigned char output[HEIGHT][WIDTH];

void blur() {
    for (int y = 1; y < HEIGHT - 1; y++) {
        for (int x = 1; x < WIDTH - 1; x++) {
            int sum = 0;
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                    sum += input[y + dy][x + dx];
            output[y][x] = sum / 9;
        }
    }
}

int main() {
    for (int y = 0; y < HEIGHT; y++)
        for (int x = 0; x < WIDTH; x++)
            input[y][x] = (x + y) % 256;

    blur();

    int sum = 0;
    for (int y = 0; y < HEIGHT; y++)
        for (int x = 0; x < WIDTH; x++)
            sum += output[y][x];

    printf("Checksum: %d\\n", sum);
    return 0;
}
`
  },
  string_search: {
    name: 'String Search',
    description: 'Sequential scan - good locality',
    language: 'c',
    code: `// String Search - Sequential Pattern
#include <stdio.h>
#include <string.h>
#define TEXT_SIZE 100000

char text[TEXT_SIZE];
const char* pattern = "needle";

int count_occurrences() {
    int count = 0, plen = 6;
    for (int i = 0; i <= TEXT_SIZE - plen; i++) {
        int match = 1;
        for (int j = 0; j < plen && match; j++)
            if (text[i + j] != pattern[j]) match = 0;
        if (match) count++;
    }
    return count;
}

int main() {
    for (int i = 0; i < TEXT_SIZE; i++) text[i] = 'a';
    for (int i = 0; i < TEXT_SIZE - 10; i += 1000)
        memcpy(&text[i], "needle", 6);

    int found = count_occurrences();
    printf("Found %d occurrences\\n", found);
    return 0;
}
`
  },
  cpp_struct: {
    name: 'C++ Structs',
    description: 'Struct layout and cache behavior',
    language: 'cpp',
    code: `#define N 1000

struct Point {
    float x, y, z;  // 12 bytes
};

Point points[N];
float result;

int main() {
    // Initialize - sequential access
    for (int i = 0; i < N; i++) {
        points[i].x = (float)i;
        points[i].y = (float)i * 2;
        points[i].z = (float)i * 3;
    }

    // Access pattern matters for cache
    float total = 0;
    for (int i = 0; i < N; i++) {
        Point& p = points[i];
        total += p.x * p.x + p.y * p.y + p.z * p.z;
    }

    result = total;
    return 0;
}
`
  },
  aos_vs_soa: {
    name: 'AoS vs SoA',
    description: 'Array of Structs vs Struct of Arrays',
    language: 'cpp',
    code: `#define N 1000

// Array of Structs - poor cache use for single field
struct ParticleAoS {
    float x, y, z;
    float vx, vy, vz;
    float mass;
    int id;  // 32 bytes total
};

// Struct of Arrays - better for field-wise access
float soa_x[N], soa_y[N], soa_z[N];
float soa_mass[N];

ParticleAoS aos[N];
float result_aos, result_soa;

int main() {
    // Initialize both layouts
    for (int i = 0; i < N; i++) {
        aos[i].x = aos[i].y = aos[i].z = (float)i;
        aos[i].mass = 1.0f;
        soa_x[i] = soa_y[i] = soa_z[i] = (float)i;
        soa_mass[i] = 1.0f;
    }

    // AoS: loads 32 bytes per element, uses only 4
    float sum_aos = 0;
    for (int i = 0; i < N; i++)
        sum_aos += aos[i].x;

    // SoA: contiguous x values, perfect cache use
    float sum_soa = 0;
    for (int i = 0; i < N; i++)
        sum_soa += soa_x[i];

    result_aos = sum_aos;
    result_soa = sum_soa;
    return 0;
}
`
  },
  cpp_template: {
    name: 'Template Array',
    description: 'Simple template with cache behavior',
    language: 'cpp',
    code: `#define N 1000

template<typename T, int Size>
struct Array {
    T data[Size];
    T& operator[](int i) { return data[i]; }
};

Array<int, N> arr;
int result;

int main() {
    // Write sequentially
    for (int i = 0; i < N; i++)
        arr[i] = i;

    // Read sequentially - cache friendly
    int sum = 0;
    for (int i = 0; i < N; i++)
        sum += arr[i];

    result = sum;
    return 0;
}
`
  },

  // === Multi-File Examples ===
  multifile_matrix_c: {
    name: 'Multi-File Matrix (C)',
    description: 'Matrix operations split across files',
    language: 'c',
    code: `// Multi-file matrix example - see other tabs
#include "matrix.h"
#include <stdio.h>

int main() {
    Matrix* a = matrix_create(64, 64);
    Matrix* b = matrix_create(64, 64);

    // Initialize with cache-friendly pattern
    for (int i = 0; i < 64; i++) {
        for (int j = 0; j < 64; j++) {
            matrix_set(a, i, j, i + j);
            matrix_set(b, i, j, i * j);
        }
    }

    Matrix* c = matrix_multiply(a, b);

    printf("Result[0][0] = %d\\n", matrix_get(c, 0, 0));
    printf("Result[63][63] = %d\\n", matrix_get(c, 63, 63));

    matrix_free(a);
    matrix_free(b);
    matrix_free(c);
    return 0;
}
`,
    files: [
      {
        name: 'main.c',
        language: 'c',
        isMain: true,
        code: `// Main program - entry point
#include "matrix.h"
#include <stdio.h>

int main() {
    Matrix* a = matrix_create(64, 64);
    Matrix* b = matrix_create(64, 64);

    // Initialize with cache-friendly pattern
    for (int i = 0; i < 64; i++) {
        for (int j = 0; j < 64; j++) {
            matrix_set(a, i, j, i + j);
            matrix_set(b, i, j, i * j);
        }
    }

    Matrix* c = matrix_multiply(a, b);

    printf("Result[0][0] = %d\\n", matrix_get(c, 0, 0));
    printf("Result[63][63] = %d\\n", matrix_get(c, 63, 63));

    matrix_free(a);
    matrix_free(b);
    matrix_free(c);
    return 0;
}
`
      },
      {
        name: 'matrix.h',
        language: 'c',
        code: `// Matrix header - shared data structures
#ifndef MATRIX_H
#define MATRIX_H

typedef struct {
    int* data;
    int rows;
    int cols;
} Matrix;

Matrix* matrix_create(int rows, int cols);
void matrix_free(Matrix* m);
int matrix_get(Matrix* m, int row, int col);
void matrix_set(Matrix* m, int row, int col, int val);
Matrix* matrix_multiply(Matrix* a, Matrix* b);

#endif
`
      },
      {
        name: 'matrix.c',
        language: 'c',
        code: `// Matrix implementation - cache behavior varies by operation
#include "matrix.h"
#include <stdlib.h>

Matrix* matrix_create(int rows, int cols) {
    Matrix* m = malloc(sizeof(Matrix));
    m->data = malloc(rows * cols * sizeof(int));
    m->rows = rows;
    m->cols = cols;
    // Initialize to zero - sequential access
    for (int i = 0; i < rows * cols; i++)
        m->data[i] = 0;
    return m;
}

void matrix_free(Matrix* m) {
    free(m->data);
    free(m);
}

int matrix_get(Matrix* m, int row, int col) {
    return m->data[row * m->cols + col];
}

void matrix_set(Matrix* m, int row, int col, int val) {
    m->data[row * m->cols + col] = val;
}

Matrix* matrix_multiply(Matrix* a, Matrix* b) {
    Matrix* c = matrix_create(a->rows, b->cols);

    // Row-major multiplication - good cache behavior
    for (int i = 0; i < a->rows; i++) {
        for (int j = 0; j < b->cols; j++) {
            int sum = 0;
            for (int k = 0; k < a->cols; k++) {
                sum += matrix_get(a, i, k) * matrix_get(b, k, j);
            }
            matrix_set(c, i, j, sum);
        }
    }
    return c;
}
`
      }
    ]
  },

  multifile_vector_cpp: {
    name: 'Multi-File Vector (C++)',
    description: 'Template container with cache-aware operations',
    language: 'cpp',
    code: `// Multi-file vector example - see other tabs
#include "vector.hpp"
#include <cstdio>

int main() {
    Vector<int> v;

    // Push 1000 elements - amortized allocation
    for (int i = 0; i < 1000; i++)
        v.push_back(i);

    // Sequential access - cache friendly
    long sum = 0;
    for (size_t i = 0; i < v.size(); i++)
        sum += v[i];

    printf("Sum: %ld, Size: %zu\\n", sum, v.size());
    return 0;
}
`,
    files: [
      {
        name: 'main.cpp',
        language: 'cpp',
        isMain: true,
        code: `// Main program using custom Vector
#include "vector.hpp"
#include <cstdio>

int main() {
    Vector<int> v;

    // Push 1000 elements - observe reallocation behavior
    for (int i = 0; i < 1000; i++)
        v.push_back(i);

    // Sequential access - excellent cache behavior
    long sum = 0;
    for (size_t i = 0; i < v.size(); i++)
        sum += v[i];

    // Random access test
    int random_sum = 0;
    for (int i = 0; i < 100; i++) {
        int idx = (i * 17) % v.size();  // Pseudo-random
        random_sum += v[idx];
    }

    printf("Sum: %ld\\n", sum);
    printf("Random sum: %d\\n", random_sum);
    printf("Size: %zu, Capacity: %zu\\n", v.size(), v.capacity());
    return 0;
}
`
      },
      {
        name: 'vector.hpp',
        language: 'cpp',
        code: `// Cache-aware Vector implementation
#ifndef VECTOR_HPP
#define VECTOR_HPP

#include <cstdlib>
#include <cstring>

template<typename T>
class Vector {
private:
    T* data_;
    size_t size_;
    size_t capacity_;

    void grow() {
        // Double capacity for amortized O(1) push
        size_t new_cap = capacity_ == 0 ? 8 : capacity_ * 2;
        T* new_data = static_cast<T*>(malloc(new_cap * sizeof(T)));

        // Copy old data - sequential memory access
        if (data_) {
            memcpy(new_data, data_, size_ * sizeof(T));
            free(data_);
        }
        data_ = new_data;
        capacity_ = new_cap;
    }

public:
    Vector() : data_(nullptr), size_(0), capacity_(0) {}

    ~Vector() {
        if (data_) free(data_);
    }

    void push_back(const T& val) {
        if (size_ >= capacity_) grow();
        data_[size_++] = val;
    }

    T& operator[](size_t idx) { return data_[idx]; }
    const T& operator[](size_t idx) const { return data_[idx]; }

    size_t size() const { return size_; }
    size_t capacity() const { return capacity_; }

    // Cache-friendly iterator access
    T* begin() { return data_; }
    T* end() { return data_ + size_; }
};

#endif
`
      }
    ]
  },

  // === Rust Examples ===
  rust_sequential: {
    name: 'Rust Sequential',
    description: 'Sequential array access in Rust',
    language: 'rust' as Language,
    code: `// Sequential array access in Rust - good cache behavior
fn main() {
    const N: usize = 1000;
    let mut arr = [0i32; N];
    let mut sum: i32 = 0;

    // Initialize array
    for i in 0..N {
        arr[i] = i as i32;
    }

    // Sequential read - cache friendly
    for i in 0..N {
        sum += arr[i];
    }

    println!("Sum: {}", sum);
}
`
  },
  rust_matrix: {
    name: 'Rust Matrix',
    description: 'Row-major matrix traversal in Rust',
    language: 'rust' as Language,
    code: `// Row-major matrix traversal in Rust
fn main() {
    const N: usize = 64;
    let mut matrix = [[0i32; N]; N];
    let mut sum: i32 = 0;

    // Initialize matrix - row-major order
    for i in 0..N {
        for j in 0..N {
            matrix[i][j] = (i + j) as i32;
        }
    }

    // Read in row-major order - cache friendly
    for i in 0..N {
        for j in 0..N {
            sum += matrix[i][j];
        }
    }

    println!("Sum: {}", sum);
}
`
  },
  rust_vec: {
    name: 'Rust Vec Iteration',
    description: 'Iterator vs index access comparison',
    language: 'rust' as Language,
    code: `// Vec iteration patterns in Rust
fn main() {
    const N: usize = 1000;
    let data: Vec<i32> = (0..N as i32).collect();

    // Method 1: Iterator (optimized by compiler)
    let sum1: i32 = data.iter().sum();

    // Method 2: Index access
    let mut sum2: i32 = 0;
    for i in 0..data.len() {
        sum2 += data[i];
    }

    // Method 3: For-each
    let mut sum3: i32 = 0;
    for &val in &data {
        sum3 += val;
    }

    println!("Sums: {} {} {}", sum1, sum2, sum3);
}
`
  },
}

const EXAMPLE_CODE = EXAMPLES.matrix_row.code

// Helper to generate unique file IDs
let fileIdCounter = 0
function generateFileId(): string {
  return `file_${++fileIdCounter}_${Date.now()}`
}

// Helper to get file extension from language
function getFileExtension(lang: Language): string {
  switch (lang) {
    case 'cpp': return '.cpp'
    case 'rust': return '.rs'
    default: return '.c'
  }
}

function createFileTab(name: string, code: string, language: Language): FileTab {
  return { id: generateFileId(), name, code, language }
}

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

// Format a delta between two values as a percentage change
function formatDelta(current: number, baseline: number): { text: string; isPositive: boolean; isNeutral: boolean } {
  const delta = current - baseline
  const deltaPercent = (delta * 100).toFixed(1)
  if (Math.abs(delta) < 0.001) {
    return { text: '0%', isPositive: false, isNeutral: true }
  }
  const sign = delta > 0 ? '+' : ''
  return { text: `${sign}${deltaPercent}%`, isPositive: delta > 0, isNeutral: false }
}

// Format a numeric delta (for cycles, counts, etc.) - positive = worse (more cycles/accesses)
function formatNumericDelta(current: number, baseline: number): { text: string; isWorse: boolean; isNeutral: boolean } {
  const delta = current - baseline
  if (delta === 0) {
    return { text: '0', isWorse: false, isNeutral: true }
  }
  const sign = delta > 0 ? '+' : ''
  return { text: `${sign}${delta.toLocaleString()}`, isWorse: delta > 0, isNeutral: false }
}

// Extract just filename:line from a full path like /tmp/cache-explorer-.../main.c:12
function formatLocation(location: string): string {
  // Match filename:line at the end of the path
  const match = location.match(/([^/]+:\d+)$/)
  return match ? match[1] : location
}

// Cache Hierarchy Level - individual bar visualization
function CacheHierarchyLevel({ name, hitRate }: { name: string; hitRate: number }) {
  const getClass = (rate: number) => rate >= 0.95 ? 'excellent' : rate >= 0.8 ? 'good' : rate >= 0.5 ? 'warning' : 'poor'
  const levelClass = getClass(hitRate)

  return (
    <div className={`cache-level ${levelClass}`}>
      <span className="cache-level-name">{name}</span>
      <div className="cache-level-bar">
        <div className="cache-level-fill" style={{ width: `${hitRate * 100}%` }} />
      </div>
      <span className="cache-level-value">{formatPercent(hitRate)}</span>
    </div>
  )
}

function CacheStats({ result }: { result: CacheResult }) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getRateClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'

  return (
    <div className="cache-stats">
      <div className="cache-stat">
        <span className="cache-stat-label">L1 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l1d.hitRate)}`}>{formatPercent(l1d.hitRate)}</span>
        <span className="cache-stat-detail">{l1d.hits.toLocaleString()} / {(l1d.hits + l1d.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">L2 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l2.hitRate)}`}>{formatPercent(l2.hitRate)}</span>
        <span className="cache-stat-detail">{l2.hits.toLocaleString()} / {(l2.hits + l2.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">L3 Hit Rate</span>
        <span className={`cache-stat-value ${getRateClass(l3.hitRate)}`}>{formatPercent(l3.hitRate)}</span>
        <span className="cache-stat-detail">{l3.hits.toLocaleString()} / {(l3.hits + l3.misses).toLocaleString()}</span>
      </div>
      <div className="cache-stat">
        <span className="cache-stat-label">Total Events</span>
        <span className="cache-stat-value">{result.events.toLocaleString()}</span>
        <span className="cache-stat-detail">{result.config}</span>
      </div>
    </div>
  )
}

// Command palette item definition
interface CommandItem {
  id: string
  icon: string
  label: string
  shortcut?: string
  action: () => void
  category?: string
}

// Fuzzy match helper
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

// Prefix-to-category mapping for command palette
const PREFIX_CATEGORIES: Record<string, string> = {
  ':': 'settings',
  '@': 'actions',
  '*': 'config',
}

const CATEGORY_LABELS: Record<string, string> = {
  'settings': 'Settings',
  'actions': 'Actions',
  'config': 'Config',
}

const CATEGORY_ORDER = ['actions', 'settings', 'config']

// Command Palette Component
function CommandPalette({
  isOpen,
  query,
  selectedIndex,
  onQueryChange,
  onSelect,
  onClose,
  onNavigate,
  inputRef,
  commands
}: {
  isOpen: boolean
  query: string
  selectedIndex: number
  onQueryChange: (q: string) => void
  onSelect: (cmd: CommandItem) => void
  onClose: () => void
  onNavigate: (delta: number) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  commands: CommandItem[]
}) {
  if (!isOpen) return null

  // Parse prefix from query
  const firstChar = query.charAt(0)
  const activePrefix = PREFIX_CATEGORIES[firstChar] ? firstChar : null
  const activeCategory = activePrefix ? PREFIX_CATEGORIES[activePrefix] : null
  const searchQuery = activePrefix ? query.slice(1).trim() : query

  // Filter commands
  let filtered: CommandItem[]
  if (activeCategory) {
    filtered = commands.filter(cmd => cmd.category === activeCategory)
    if (searchQuery) {
      filtered = filtered.filter(cmd => fuzzyMatch(searchQuery, cmd.label))
    }
  } else if (searchQuery) {
    filtered = commands.filter(cmd => fuzzyMatch(searchQuery, cmd.label) || fuzzyMatch(searchQuery, cmd.category || ''))
  } else {
    filtered = commands
  }

  // Group by category when showing all (no prefix, no search)
  const showGrouped = !activePrefix && !searchQuery
  const groupedCommands: { category: string; items: CommandItem[] }[] = []
  if (showGrouped) {
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter(cmd => cmd.category === cat)
      if (items.length > 0) {
        groupedCommands.push({ category: cat, items })
      }
    }
  }

  // Flatten for keyboard navigation
  const flatFiltered = showGrouped
    ? groupedCommands.flatMap(g => g.items)
    : filtered

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onNavigate(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onNavigate(-1)
    } else if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
      e.preventDefault()
      onSelect(flatFiltered[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && query === activePrefix) {
      e.preventDefault()
      onQueryChange('')
    }
  }

  const clearPrefix = () => {
    onQueryChange('')
  }

  // Render grouped or flat list
  const renderCommands = () => {
    if (showGrouped) {
      let globalIndex = 0
      return groupedCommands.map(group => (
        <div key={group.category} className="command-group">
          <div className="command-group-header">{CATEGORY_LABELS[group.category]}</div>
          {group.items.map(cmd => {
            const idx = globalIndex++
            return (
              <div
                key={cmd.id}
                className={`command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => onNavigate(idx - selectedIndex)}
              >
                <span className="command-item-icon">{cmd.icon}</span>
                <span className="command-item-label">{cmd.label}</span>
                {cmd.shortcut && <span className="command-item-shortcut">{cmd.shortcut}</span>}
              </div>
            )
          })}
        </div>
      ))
    }
    return flatFiltered.map((cmd, i) => (
      <div
        key={cmd.id}
        className={`command-item ${i === selectedIndex ? 'selected' : ''}`}
        onClick={() => onSelect(cmd)}
        onMouseEnter={() => onNavigate(i - selectedIndex)}
      >
        <span className="command-item-icon">{cmd.icon}</span>
        <span className="command-item-label">{cmd.label}</span>
        {cmd.shortcut && <span className="command-item-shortcut">{cmd.shortcut}</span>}
      </div>
    ))
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-input-wrapper">
          {activePrefix ? (
            <span className="command-filter-badge" onClick={clearPrefix}>
              {CATEGORY_LABELS[activeCategory!]} {activePrefix}
              <span className="badge-clear">×</span>
            </span>
          ) : (
            <span className="command-icon">/</span>
          )}
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder={activePrefix ? `Search ${CATEGORY_LABELS[activeCategory!].toLowerCase()}...` : ': settings  @ actions  * config'}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        </div>
        <div className="command-list">
          {renderCommands()}
          {flatFiltered.length === 0 && (
            <div className="command-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Styled dropdown component matching site aesthetic
interface SelectOption {
  value: string
  label: string
  group?: string
  desc?: string
}

function StyledSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find(o => o.value === value)
  const groups = [...new Set(options.map(o => o.group).filter(Boolean))]
  const hasGroups = groups.length > 0

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      // Scroll to selected item
      const idx = options.findIndex(o => o.value === value)
      if (idx >= 0) setHighlightedIndex(idx)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, value, options])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => Math.min(prev + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          onChange(options[highlightedIndex].value)
          setIsOpen(false)
        }
        break
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('.styled-select-option')
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, isOpen])

  const renderOptions = () => {
    if (hasGroups) {
      return groups.map(group => (
        <div key={group} className="styled-select-group">
          <div className="styled-select-group-label">{group}</div>
          {options
            .filter(o => o.group === group)
            .map(option => {
              const idx = options.indexOf(option)
              return (
                <div
                  key={option.value}
                  className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
                  onClick={() => { onChange(option.value); setIsOpen(false) }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  {option.value === value && <span className="check-mark">✓</span>}
                  <span className="option-content">
                    <span className="option-label">{option.label}</span>
                    {option.desc && <span className="option-desc">{option.desc}</span>}
                  </span>
                </div>
              )
            })}
        </div>
      ))
    }

    return options.map((option, idx) => (
      <div
        key={option.value}
        className={`styled-select-option ${option.value === value ? 'selected' : ''} ${idx === highlightedIndex ? 'highlighted' : ''}`}
        onClick={() => { onChange(option.value); setIsOpen(false) }}
        onMouseEnter={() => setHighlightedIndex(idx)}
      >
        {option.value === value && <span className="check-mark">✓</span>}
        <span className="option-content">
          <span className="option-label">{option.label}</span>
          {option.desc && <span className="option-desc">{option.desc}</span>}
        </span>
      </div>
    ))
  }

  return (
    <div
      ref={containerRef}
      className={`styled-select ${isOpen ? 'open' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="styled-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        <span className="styled-select-value">{selectedOption?.label || placeholder}</span>
        <span className="styled-select-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div ref={listRef} className="styled-select-dropdown">
          {renderOptions()}
        </div>
      )}
    </div>
  )
}

function LevelDetail({ name, stats }: { name: string; stats: CacheStats }) {
  const has3C = stats.compulsory !== undefined || stats.capacity !== undefined || stats.conflict !== undefined
  const total3C = (stats.compulsory || 0) + (stats.capacity || 0) + (stats.conflict || 0)

  return (
    <div className="level-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.9 ? 'good' : stats.hitRate > 0.7 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
      {has3C && total3C > 0 && (
        <div className="level-3c">
          <div className="level-3c-header">Miss Breakdown</div>
          <div className="level-3c-bar">
            {stats.compulsory! > 0 && (
              <div
                className="level-3c-segment compulsory"
                style={{ width: `${(stats.compulsory! / total3C) * 100}%` }}
                title={`Cold: ${stats.compulsory!.toLocaleString()} (${((stats.compulsory! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
            {stats.capacity! > 0 && (
              <div
                className="level-3c-segment capacity"
                style={{ width: `${(stats.capacity! / total3C) * 100}%` }}
                title={`Capacity: ${stats.capacity!.toLocaleString()} (${((stats.capacity! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
            {stats.conflict! > 0 && (
              <div
                className="level-3c-segment conflict"
                style={{ width: `${(stats.conflict! / total3C) * 100}%` }}
                title={`Conflict: ${stats.conflict!.toLocaleString()} (${((stats.conflict! / total3C) * 100).toFixed(1)}%)`}
              />
            )}
          </div>
          <div className="level-3c-details">
            {stats.compulsory! > 0 && (
              <div className="level-3c-item">
                <span className="dot compulsory" />
                <span className="label">Cold</span>
                <span className="value">{stats.compulsory!.toLocaleString()}</span>
                <span className="percent">{((stats.compulsory! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
            {stats.capacity! > 0 && (
              <div className="level-3c-item">
                <span className="dot capacity" />
                <span className="label">Capacity</span>
                <span className="value">{stats.capacity!.toLocaleString()}</span>
                <span className="percent">{((stats.capacity! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
            {stats.conflict! > 0 && (
              <div className="level-3c-item">
                <span className="dot conflict" />
                <span className="label">Conflict</span>
                <span className="value">{stats.conflict!.toLocaleString()}</span>
                <span className="percent">{((stats.conflict! / total3C) * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

function TLBDetail({ name, stats }: { name: string; stats: TLBStats }) {
  const totalAccesses = stats.hits + stats.misses
  if (totalAccesses === 0) return null

  return (
    <div className="level-detail tlb-detail">
      <div className="level-header">{name}</div>
      <div className="level-row">
        <span>Hits</span>
        <span className="mono">{stats.hits.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Misses</span>
        <span className="mono">{stats.misses.toLocaleString()}</span>
      </div>
      <div className="level-row">
        <span>Hit Rate</span>
        <span className={`mono ${stats.hitRate > 0.95 ? 'good' : stats.hitRate > 0.85 ? 'ok' : 'bad'}`}>
          {formatPercent(stats.hitRate)}
        </span>
      </div>
    </div>
  )
}

function TimingDisplay({ timing, baselineTiming, diffMode }: { timing: TimingStats; baselineTiming?: TimingStats | null; diffMode?: boolean }) {
  const { breakdown, totalCycles, avgLatency } = timing
  const totalBreakdown = breakdown.l1HitCycles + breakdown.l2HitCycles + breakdown.l3HitCycles + breakdown.memoryCycles

  // Calculate percentages for breakdown bar
  const l1Pct = totalBreakdown > 0 ? (breakdown.l1HitCycles / totalBreakdown) * 100 : 0
  const l2Pct = totalBreakdown > 0 ? (breakdown.l2HitCycles / totalBreakdown) * 100 : 0
  const l3Pct = totalBreakdown > 0 ? (breakdown.l3HitCycles / totalBreakdown) * 100 : 0
  const memPct = totalBreakdown > 0 ? (breakdown.memoryCycles / totalBreakdown) * 100 : 0

  // Calculate deltas for diff mode
  const cyclesDelta = diffMode && baselineTiming ? formatNumericDelta(totalCycles, baselineTiming.totalCycles) : null

  return (
    <div className="timing-display">
      <div className="timing-header">
        <span className="timing-label">Timing</span>
        <span className="timing-value">
          {totalCycles.toLocaleString()}
          {cyclesDelta && (
            <span className={`timing-delta ${cyclesDelta.isNeutral ? 'neutral' : cyclesDelta.isWorse ? 'worse' : 'better'}`}>
              {cyclesDelta.text}
            </span>
          )}
        </span>
        <span className="timing-unit">cycles ({avgLatency.toFixed(1)} avg)</span>
      </div>
      <div className="timing-bar">
        {l1Pct > 0 && <div className="timing-segment l1" style={{ width: `${l1Pct}%` }} title={`L1: ${breakdown.l1HitCycles.toLocaleString()} cycles`} />}
        {l2Pct > 0 && <div className="timing-segment l2" style={{ width: `${l2Pct}%` }} title={`L2: ${breakdown.l2HitCycles.toLocaleString()} cycles`} />}
        {l3Pct > 0 && <div className="timing-segment l3" style={{ width: `${l3Pct}%` }} title={`L3: ${breakdown.l3HitCycles.toLocaleString()} cycles`} />}
        {memPct > 0 && <div className="timing-segment mem" style={{ width: `${memPct}%` }} title={`Memory: ${breakdown.memoryCycles.toLocaleString()} cycles`} />}
      </div>
      <div className="timing-legend">
        {l1Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l1" />L1 {l1Pct.toFixed(0)}%</span>}
        {l2Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l2" />L2 {l2Pct.toFixed(0)}%</span>}
        {l3Pct > 0 && <span className="timing-legend-item"><span className="timing-dot l3" />L3 {l3Pct.toFixed(0)}%</span>}
        {memPct > 0 && <span className="timing-legend-item"><span className="timing-dot mem" />Mem {memPct.toFixed(0)}%</span>}
      </div>
    </div>
  )
}

// Hardware preset options with groups
const HARDWARE_OPTIONS: SelectOption[] = [
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

const OPT_LEVEL_OPTIONS: SelectOption[] = [
  { value: '-O0', label: '-O0', desc: 'No optimization - best for debugging' },
  { value: '-O1', label: '-O1', desc: 'Basic optimizations' },
  { value: '-O2', label: '-O2', desc: 'Standard optimizations' },
  { value: '-O3', label: '-O3', desc: 'Aggressive optimizations' },
  { value: '-Os', label: '-Os', desc: 'Optimize for size' },
]

const PREFETCH_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None', desc: 'No hardware prefetching' },
  { value: 'next', label: 'Next Line', desc: 'Prefetch adjacent cache line on miss' },
  { value: 'stream', label: 'Stream', desc: 'Detect sequential access patterns' },
  { value: 'stride', label: 'Stride', desc: 'Detect strided access patterns' },
  { value: 'adaptive', label: 'Adaptive', desc: 'Combines stream + stride detection' },
  { value: 'intel', label: 'Intel DCU', desc: 'Intel Data Cache Unit prefetcher' },
]

const LIMIT_OPTIONS: SelectOption[] = [
  { value: '10000', label: '10K' },
  { value: '50000', label: '50K' },
  { value: '100000', label: '100K' },
  { value: '500000', label: '500K' },
  { value: '1000000', label: '1M' },
]

const SAMPLE_OPTIONS: SelectOption[] = [
  { value: '1', label: '1:1 (all)' },
  { value: '2', label: '1:2' },
  { value: '4', label: '1:4' },
  { value: '8', label: '1:8' },
  { value: '16', label: '1:16' },
]

const FAST_MODE_OPTIONS: SelectOption[] = [
  { value: 'false', label: 'Full (3C)', desc: 'Tracks compulsory, capacity, conflict misses' },
  { value: 'true', label: 'Fast', desc: '~3x faster, skips miss classification' },
]

// Godbolt-style inline settings toolbar
function SettingsToolbar({
  config,
  optLevel,
  prefetchPolicy,
  compilers,
  selectedCompiler,
  defines,
  customConfig,
  eventLimit,
  sampleRate,
  fastMode,
  onConfigChange,
  onOptLevelChange,
  onPrefetchChange,
  onCompilerChange,
  onDefinesChange,
  onCustomConfigChange,
  onEventLimitChange,
  onSampleRateChange,
  onFastModeChange,
}: {
  config: string
  optLevel: string
  prefetchPolicy: string
  compilers: Compiler[]
  selectedCompiler: string
  defines: DefineEntry[]
  customConfig: CustomCacheConfig
  eventLimit: number
  sampleRate: number
  fastMode: boolean
  onConfigChange: (c: string) => void
  onOptLevelChange: (o: string) => void
  onPrefetchChange: (p: string) => void
  onCompilerChange: (c: string) => void
  onDefinesChange: (d: DefineEntry[]) => void
  onCustomConfigChange: (c: CustomCacheConfig) => void
  onEventLimitChange: (n: number) => void
  onSampleRateChange: (n: number) => void
  onFastModeChange: (f: boolean) => void
}) {
  const [showMore, setShowMore] = useState(config === 'custom')

  // Auto-expand when custom is selected
  useEffect(() => {
    if (config === 'custom') setShowMore(true)
  }, [config])

  // Build compiler options dynamically
  const compilerOptions: SelectOption[] = compilers.map(c => ({ value: c.id, label: c.name }))

  return (
    <div className="settings-toolbar">
      <div className="settings-toolbar-main">
        {/* Hardware Preset */}
        <div className="toolbar-group">
          <label>Hardware</label>
          <StyledSelect
            value={config}
            options={HARDWARE_OPTIONS}
            onChange={onConfigChange}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Optimization Level */}
        <div className="toolbar-group">
          <label>Opt</label>
          <StyledSelect
            value={optLevel}
            options={OPT_LEVEL_OPTIONS}
            onChange={onOptLevelChange}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Compiler */}
        {compilers.length > 0 && (
          <>
            <div className="toolbar-group">
              <label>Compiler</label>
              <StyledSelect
                value={selectedCompiler}
                options={compilerOptions}
                onChange={onCompilerChange}
              />
            </div>
            <div className="toolbar-divider" />
          </>
        )}

        {/* Prefetch Policy */}
        <div className="toolbar-group">
          <label>Prefetch</label>
          <StyledSelect
            value={prefetchPolicy}
            options={PREFETCH_OPTIONS}
            onChange={onPrefetchChange}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Event Limit */}
        <div className="toolbar-group">
          <label>Limit</label>
          <StyledSelect
            value={String(eventLimit)}
            options={LIMIT_OPTIONS}
            onChange={(v) => onEventLimitChange(parseInt(v))}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Sampling Rate */}
        <div className="toolbar-group">
          <label>Sample</label>
          <StyledSelect
            value={String(sampleRate)}
            options={SAMPLE_OPTIONS}
            onChange={(v) => onSampleRateChange(parseInt(v))}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Fast Mode Toggle */}
        <div className="toolbar-group">
          <label title="Fast mode disables 3C miss classification for ~3x speedup">Mode</label>
          <StyledSelect
            value={String(fastMode)}
            options={FAST_MODE_OPTIONS}
            onChange={(v) => onFastModeChange(v === 'true')}
          />
        </div>

        {/* More Options Toggle */}
        <button
          className={`toolbar-more ${showMore ? 'active' : ''}`}
          onClick={() => setShowMore(!showMore)}
          title="More options"
        >
          {showMore ? '▲ Less' : '▼ More'}
        </button>
      </div>

      {/* Expandable Advanced Options */}
      {showMore && (
        <div className="settings-toolbar-advanced">
          {/* Preprocessor Defines */}
          <div className="toolbar-advanced-section">
            <span className="toolbar-advanced-label">Defines:</span>
            <div className="toolbar-defines">
              {defines.length === 0 ? (
                <div className="defines-presets">
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'N', value: '1000' }])}>N=1000</button>
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'SIZE', value: '256' }])}>SIZE=256</button>
                  <button className="define-preset" onClick={() => onDefinesChange([{ name: 'BLOCK', value: '64' }])}>BLOCK=64</button>
                  <button className="define-preset define-custom" onClick={() => onDefinesChange([{ name: '', value: '' }])}>+ Custom</button>
                </div>
              ) : (
                <>
                  {defines.map((def, i) => (
                    <div key={i} className="toolbar-define">
                      <span className="define-prefix">-D</span>
                      <input
                        type="text"
                        placeholder="NAME"
                        value={def.name}
                        onChange={(e) => {
                          const newDefs = [...defines]
                          newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                          onDefinesChange(newDefs)
                        }}
                        className="define-input name"
                      />
                      <span className="define-eq">=</span>
                      <input
                        type="text"
                        placeholder="value"
                        value={def.value}
                        onChange={(e) => {
                          const newDefs = [...defines]
                          newDefs[i].value = e.target.value
                          onDefinesChange(newDefs)
                        }}
                        className="define-input value"
                      />
                      <button
                        className="define-remove"
                        onClick={() => onDefinesChange(defines.filter((_, j) => j !== i))}
                        title="Remove define"
                      >×</button>
                    </div>
                  ))}
                  <button
                    className="define-add"
                    onClick={() => onDefinesChange([...defines, { name: '', value: '' }])}
                  >+</button>
                </>
              )}
            </div>
          </div>

          {/* Custom Cache Config */}
          {config === 'custom' && (
            <div className="toolbar-advanced-section custom-cache-section">
              <span className="toolbar-advanced-label">Cache Config:</span>
              <div className="toolbar-cache-config">
                <div className="cache-config-group">
                  <span className="cache-config-title">Line Size</span>
                  <select value={customConfig.lineSize} onChange={e => onCustomConfigChange({ ...customConfig, lineSize: parseInt(e.target.value) })}>
                    <option value={32}>32 B</option>
                    <option value={64}>64 B</option>
                    <option value={128}>128 B</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L1 Data</span>
                  <select value={customConfig.l1Size} onChange={e => onCustomConfigChange({ ...customConfig, l1Size: parseInt(e.target.value) })}>
                    <option value={8192}>8 KB</option>
                    <option value={16384}>16 KB</option>
                    <option value={32768}>32 KB</option>
                    <option value={49152}>48 KB</option>
                    <option value={65536}>64 KB</option>
                  </select>
                  <select value={customConfig.l1Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l1Assoc: parseInt(e.target.value) })}>
                    <option value={4}>4-way</option>
                    <option value={8}>8-way</option>
                    <option value={12}>12-way</option>
                    <option value={16}>16-way</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L2</span>
                  <select value={customConfig.l2Size} onChange={e => onCustomConfigChange({ ...customConfig, l2Size: parseInt(e.target.value) })}>
                    <option value={131072}>128 KB</option>
                    <option value={262144}>256 KB</option>
                    <option value={524288}>512 KB</option>
                    <option value={1048576}>1 MB</option>
                    <option value={2097152}>2 MB</option>
                  </select>
                  <select value={customConfig.l2Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l2Assoc: parseInt(e.target.value) })}>
                    <option value={4}>4-way</option>
                    <option value={8}>8-way</option>
                    <option value={16}>16-way</option>
                  </select>
                </div>
                <div className="cache-config-group">
                  <span className="cache-config-title">L3</span>
                  <select value={customConfig.l3Size} onChange={e => onCustomConfigChange({ ...customConfig, l3Size: parseInt(e.target.value) })}>
                    <option value={0}>None</option>
                    <option value={2097152}>2 MB</option>
                    <option value={4194304}>4 MB</option>
                    <option value={8388608}>8 MB</option>
                    <option value={16777216}>16 MB</option>
                    <option value={33554432}>32 MB</option>
                  </select>
                  <select value={customConfig.l3Assoc} onChange={e => onCustomConfigChange({ ...customConfig, l3Assoc: parseInt(e.target.value) })} disabled={customConfig.l3Size === 0}>
                    <option value={8}>8-way</option>
                    <option value={12}>12-way</option>
                    <option value={16}>16-way</option>
                    <option value={20}>20-way</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// L1 Cache Grid Visualization - shows final cache state with MESI colors
function CacheGrid({ cacheState, coreCount }: { cacheState: CacheState; coreCount: number }) {
  const [selectedCore, setSelectedCore] = useState(0)

  if (!cacheState.l1d || cacheState.l1d.length === 0) {
    return <div className="cache-grid-empty">No cache state available</div>
  }

  const coreData = cacheState.l1d[selectedCore]
  if (!coreData) return null

  const { sets, ways, lines } = coreData

  // Create a 2D grid from flat lines array
  const grid: (CacheLineState | null)[][] = Array.from({ length: sets }, () =>
    Array(ways).fill(null)
  )

  for (const line of lines) {
    if (line.s < sets && line.w < ways) {
      grid[line.s][line.w] = line
    }
  }

  const getStateColor = (state?: string) => {
    switch (state) {
      case 'M': return 'state-modified'
      case 'E': return 'state-exclusive'
      case 'S': return 'state-shared'
      default: return 'state-invalid'
    }
  }

  const getStateLabel = (state?: string) => {
    switch (state) {
      case 'M': return 'Modified'
      case 'E': return 'Exclusive'
      case 'S': return 'Shared'
      default: return 'Invalid'
    }
  }

  return (
    <div className="cache-grid-container">
      <div className="cache-grid-header">
        {coreCount > 1 && (
          <div className="core-selector">
            <label>Core:</label>
            <select
              value={selectedCore}
              onChange={(e) => setSelectedCore(Number(e.target.value))}
            >
              {Array.from({ length: coreCount }, (_, i) => (
                <option key={i} value={i}>Core {i}</option>
              ))}
            </select>
          </div>
        )}
        <div className="cache-grid-legend">
          <span className="legend-item"><span className="legend-color state-modified"></span>Modified</span>
          <span className="legend-item"><span className="legend-color state-exclusive"></span>Exclusive</span>
          <span className="legend-item"><span className="legend-color state-shared"></span>Shared</span>
          <span className="legend-item"><span className="legend-color state-invalid"></span>Invalid</span>
        </div>
      </div>

      <div className="cache-grid-info">
        L1D: {sets} sets × {ways} ways = {sets * ways} lines
      </div>

      <div className="cache-grid" style={{
        gridTemplateColumns: `auto repeat(${ways}, 1fr)`,
        maxWidth: Math.min(ways * 24 + 40, 600)
      }}>
        {/* Header row */}
        <div className="grid-header-cell"></div>
        {Array.from({ length: ways }, (_, w) => (
          <div key={`h${w}`} className="grid-header-cell">W{w}</div>
        ))}

        {/* Data rows - show all sets or paginate if too many */}
        {grid.slice(0, Math.min(sets, 64)).map((row, setIdx) => {
          const cells = [
            <div key={`label-${setIdx}`} className="grid-set-label">S{setIdx}</div>,
            ...row.map((line, wayIdx) => (
              <div
                key={`${setIdx}-${wayIdx}`}
                className={`grid-cell ${line?.v ? getStateColor(line.st) : 'state-invalid'}`}
                title={line?.v
                  ? `Set ${setIdx}, Way ${wayIdx}\nTag: ${line.t}\nState: ${getStateLabel(line.st)}`
                  : `Set ${setIdx}, Way ${wayIdx}\nEmpty`
                }
              />
            ))
          ]
          return cells
        })}
      </div>

      {sets > 64 && (
        <div className="cache-grid-note">
          Showing first 64 of {sets} sets
        </div>
      )}
    </div>
  )
}

// False Sharing Visualization Component
function FalseSharingViz({ falseSharing, lineSize = 64 }: {
  falseSharing: FalseSharingEvent[]
  lineSize?: number
}) {
  if (!falseSharing || falseSharing.length === 0) return null

  // Get unique thread IDs for color assignment
  const threadColors: Record<number, string> = {}
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e']
  let colorIdx = 0

  falseSharing.forEach(fs => {
    fs.accesses.forEach(a => {
      if (!(a.threadId in threadColors)) {
        threadColors[a.threadId] = colors[colorIdx % colors.length]
        colorIdx++
      }
    })
  })

  return (
    <div className="false-sharing-viz">
      <div className="section-title">False Sharing Details</div>
      <p className="viz-description">
        Multiple threads accessing different bytes in the same {lineSize}-byte cache line.
        This causes cache invalidations and performance loss.
      </p>

      {falseSharing.slice(0, 5).map((fs, idx) => {
        // Build byte access map
        const byteAccess: { threadId: number; isWrite: boolean; count: number }[] = Array(lineSize).fill(null)

        fs.accesses.forEach(a => {
          const offset = a.offset % lineSize
          if (!byteAccess[offset]) {
            byteAccess[offset] = { threadId: a.threadId, isWrite: a.isWrite, count: a.count }
          } else {
            byteAccess[offset].count += a.count
          }
        })

        // Get unique threads for this cache line
        const threads = [...new Set(fs.accesses.map(a => a.threadId))]

        return (
          <div key={idx} className="cache-line-viz">
            <div className="cache-line-header">
              <code>Cache Line {fs.cacheLineAddr}</code>
              <span className="access-count">{fs.accessCount.toLocaleString()} accesses</span>
            </div>

            <div className="byte-grid" style={{ gridTemplateColumns: `repeat(${Math.min(lineSize, 32)}, 1fr)` }}>
              {byteAccess.slice(0, Math.min(lineSize, 32)).map((access, byteIdx) => (
                <div
                  key={byteIdx}
                  className={`byte-cell ${access ? (access.isWrite ? 'write' : 'read') : 'unused'}`}
                  style={access ? { backgroundColor: threadColors[access.threadId] } : undefined}
                  title={access ? `Thread ${access.threadId}: ${access.count} ${access.isWrite ? 'writes' : 'reads'} at offset ${byteIdx}` : `Byte ${byteIdx}`}
                />
              ))}
            </div>
            {lineSize > 32 && <div className="byte-ellipsis">... {lineSize - 32} more bytes</div>}

            <div className="thread-legend">
              {threads.map(tid => (
                <span key={tid} className="thread-tag" style={{ backgroundColor: threadColors[tid] }}>
                  Thread {tid}
                </span>
              ))}
            </div>

            <div className="access-details">
              {fs.accesses.slice(0, 4).map((a, i) => (
                <div key={i} className="access-item">
                  <span className="thread-dot" style={{ backgroundColor: threadColors[a.threadId] }} />
                  <code>{a.file}:{a.line}</code>
                  <span className="access-type">{a.isWrite ? 'W' : 'R'}</span>
                  <span className="access-offset">+{a.offset}</span>
                </div>
              ))}
              {fs.accesses.length > 4 && (
                <div className="access-more">... and {fs.accesses.length - 4} more</div>
              )}
            </div>
          </div>
        )
      })}

      {falseSharing.length > 5 && (
        <div className="more-events">... {falseSharing.length - 5} more false sharing events</div>
      )}

      <div className="fix-suggestion">
        <strong>Fix:</strong> Add padding between fields accessed by different threads to ensure they're on separate cache lines.
        For a {lineSize}-byte line, add at least {lineSize} bytes of padding.
      </div>
    </div>
  )
}

function ErrorDisplay({ error }: { error: ErrorResult }) {
  const titles: Record<string, string> = {
    compile_error: 'Compilation Failed',
    linker_error: 'Linker Error',
    runtime_error: 'Runtime Error',
    timeout: 'Timeout',
    unknown_error: 'Error',
    validation_error: 'Invalid Request',
    server_error: 'Server Error'
  }

  const icons: Record<string, string> = {
    compile_error: '\u2717',
    linker_error: '\u26D4',
    runtime_error: '\u26A0',
    timeout: '\u23F1',
    unknown_error: '\u2753',
    validation_error: '\u26A0',
    server_error: '\u26A0'
  }

  return (
    <div className="error-box">
      <div className="error-header">
        <span className="error-icon">{icons[error.type] || '\u2717'}</span>
        <span className="error-title">{titles[error.type] || 'Error'}</span>
        {error.summary && <span className="error-summary">{error.summary}</span>}
      </div>

      {error.errors?.map((e, i) => (
        <div key={i} className={`error-item ${e.severity}`}>
          <div className="error-item-header">
            <span className="error-loc">Line {e.line}:{e.column}</span>
            <span className={`error-severity ${e.severity}`}>{e.severity}</span>
          </div>
          <div className="error-msg">{e.message}</div>

          {e.sourceLine && (
            <pre className="error-source">
              <code>{e.sourceLine}</code>
              {e.caret && <code className="error-caret">{e.caret}</code>}
            </pre>
          )}

          {e.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {e.suggestion}
            </div>
          )}

          {e.notes && e.notes.length > 0 && (
            <div className="error-notes">
              {e.notes.map((note, j) => (
                <div key={j} className="error-note">\u2192 {note}</div>
              ))}
            </div>
          )}
        </div>
      ))}

      {error.message && (
        <div className="error-message-box">
          <div className="error-msg">{error.message}</div>
          {error.suggestion && (
            <div className="error-suggestion">
              <span className="suggestion-icon">{'\u{1F4A1}'}</span> {error.suggestion}
            </div>
          )}
        </div>
      )}

      {error.raw && <pre className="error-pre">{error.raw}</pre>}
      {error.error && <pre className="error-pre">{error.error}</pre>}
    </div>
  )
}

type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

interface DefineEntry {
  name: string
  value: string
}

interface CustomCacheConfig {
  l1Size: number
  l1Assoc: number
  lineSize: number
  l2Size: number
  l2Assoc: number
  l3Size: number
  l3Assoc: number
}

const defaultCustomConfig: CustomCacheConfig = {
  l1Size: 32768,
  l1Assoc: 8,
  lineSize: 64,
  l2Size: 262144,
  l2Assoc: 8,
  l3Size: 8388608,
  l3Assoc: 16
}

interface ShareableState {
  code: string
  config: string
  optLevel: string
  language?: Language
  defines?: DefineEntry[]
}

function encodeState(state: ShareableState): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(state))
}

function decodeState(encoded: string): ShareableState | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded)
    if (!json) return null
    return JSON.parse(json)
  } catch {
    return null
  }
}

type PrefetchPolicy = 'none' | 'next' | 'stream' | 'stride' | 'adaptive'

// Default prefetch policies for hardware presets (based on real hardware behavior)
const PREFETCH_DEFAULTS: Record<string, PrefetchPolicy> = {
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

function App() {
  // Embed mode detection from URL params
  const urlParams = new URLSearchParams(window.location.search)
  const isEmbedMode = urlParams.get('embed') === 'true'
  const isReadOnly = urlParams.get('readonly') === 'true'

  // Multi-file state - use files array instead of single code
  const [files, setFiles] = useState<FileTab[]>(() => [
    createFileTab('main.c', EXAMPLE_CODE, 'c')
  ])
  const [activeFileId, setActiveFileId] = useState<string>(() => files[0]?.id || '')
  const [mainFileId, setMainFileId] = useState<string>(() => files[0]?.id || '')

  // Derived state for current file
  const activeFile = files.find(f => f.id === activeFileId) || files[0]
  const code = activeFile?.code || ''
  const language = activeFile?.language || 'c'

  // File management functions
  const updateActiveCode = useCallback((newCode: string) => {
    setFiles(prev => prev.map(f =>
      f.id === activeFileId ? { ...f, code: newCode } : f
    ))
  }, [activeFileId])

  const updateActiveLanguage = useCallback((newLang: Language) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== activeFileId) return f
      // Update extension if name has one
      const ext = getFileExtension(newLang)
      const baseName = f.name.replace(/\.(c|cpp|rs)$/, '')
      return { ...f, language: newLang, name: baseName + ext }
    }))
  }, [activeFileId])

  const closeFile = useCallback((id: string) => {
    if (files.length <= 1) return // Don't close last file
    const idx = files.findIndex(f => f.id === id)
    setFiles(prev => prev.filter(f => f.id !== id))
    // If closing active file, switch to adjacent
    if (id === activeFileId) {
      const newIdx = Math.min(idx, files.length - 2)
      const newActive = files.filter(f => f.id !== id)[newIdx]
      if (newActive) setActiveFileId(newActive.id)
    }
  }, [files, activeFileId])

  const renameFile = useCallback((id: string, name: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name } : f
    ))
  }, [])

  // FileManager-compatible createFile callback
  const createFile = useCallback((name: string, language: 'c' | 'cpp' | 'rust') => {
    const newFile = createFileTab(name, '', language)
    setFiles(prev => [...prev, newFile])
    setActiveFileId(newFile.id)
  }, [])

  // Convert files to ProjectFile format for FileManager
  const projectFiles: ProjectFile[] = useMemo(() =>
    files.map(f => ({
      id: f.id,
      name: f.name,
      code: f.code,
      language: f.language,
      isMain: f.id === mainFileId
    }))
  , [files, mainFileId])

  const [config, setConfig] = useState('educational')
  const [optLevel, setOptLevel] = useState('-O0')
  const [prefetchPolicy, setPrefetchPolicy] = useState<PrefetchPolicy>('none')
  const [compilers, setCompilers] = useState<Compiler[]>([])
  const [selectedCompiler, setSelectedCompiler] = useState<string>('')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cache-explorer-theme')
      if (saved === 'light' || saved === 'dark') return saved
    }
    return 'dark'
  })
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [exampleLangFilter, setExampleLangFilter] = useState<'all' | 'c' | 'cpp'>('all')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [sampleRate, setSampleRate] = useState(1)  // 1 = no sampling
  const [fastMode, setFastMode] = useState(false)  // false = full 3C tracking
  const [eventLimit, setEventLimit] = useState(20000)  // Start with -O0 default (20K)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [baselineResult, setBaselineResult] = useState<CacheResult | null>(null)
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [mobilePane, setMobilePane] = useState<'editor' | 'results'>('editor')
  const [selectedHotLineFile, setSelectedHotLineFile] = useState<string>('')  // File filter for hot lines
  const [batchResults, setBatchResults] = useState<{config: string; result: CacheResult}[]>([])
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])  // For hover/miss decorations
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

  // Adjust event limit based on optimization level
  // -O0 generates way more memory events (no register optimization)
  useEffect(() => {
    const limits: Record<string, number> = {
      '-O0': 20000,    // 20K - unoptimized code floods with events
      '-O1': 50000,    // 50K - partial optimization
      '-O2': 100000,   // 100K - good optimization
      '-O3': 100000,   // 100K - aggressive optimization
      '-Os': 100000,   // 100K - size optimization
      '-Oz': 100000,   // 100K - aggressive size optimization
    }
    setEventLimit(limits[optLevel] || 100000)
  }, [optLevel])

  // Fetch available compilers on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/compilers`)
      .then(res => res.json())
      .then(data => {
        if (data.compilers && data.compilers.length > 0) {
          setCompilers(data.compilers)
          setSelectedCompiler(data.default || data.compilers[0].id)
        }
      })
      .catch(err => {
        console.warn('Failed to fetch compilers:', err)
      })
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  useEffect(() => {
    if (vimMode && editorRef.current && vimStatusRef.current) {
      vimModeRef.current = initVimMode(editorRef.current, vimStatusRef.current)
    } else if (vimModeRef.current) {
      vimModeRef.current.dispose()
      vimModeRef.current = null
    }
    return () => {
      if (vimModeRef.current) {
        vimModeRef.current.dispose()
        vimModeRef.current = null
      }
    }
  }, [vimMode])

  // Mobile detection - update on resize
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(true)
        setCommandQuery('')
        setSelectedCommandIndex(0)
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (stage === 'idle') runAnalysis()
      }
      // Escape to close command palette
      if (e.key === 'Escape') {
        setShowCommandPalette(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Load state from URL on mount
  useEffect(() => {
    const loadState = async () => {
      const params = new URLSearchParams(window.location.search)
      const shortId = params.get('s')

      // Helper to apply loaded state to the first file
      const applyState = (state: { code: string; config: string; optLevel: string; language?: Language; defines?: DefineEntry[] }) => {
        const lang = state.language || 'c'
        const newFile = createFileTab(`main${getFileExtension(lang)}`, state.code, lang)
        setFiles([newFile])
        setActiveFileId(newFile.id)  // Must update to match new file's ID
        setMainFileId(newFile.id)
        setConfig(state.config)
        setOptLevel(state.optLevel)
        if (state.defines) setDefines(state.defines)
      }

      if (shortId) {
        try {
          const response = await fetch(`${API_BASE}/s/${shortId}`)
          const data = await response.json()
          if (data.state) {
            applyState(data.state)
            return
          }
        } catch { /* ignore */ }
      }

      const hash = window.location.hash.slice(1)
      if (hash) {
        const saved = decodeState(hash)
        if (saved) {
          applyState(saved)
        }
      }
    }
    loadState()
  }, [])

  // Update URL when state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const encoded = encodeState({ code, config, optLevel, language, defines })
      window.history.replaceState(null, '', `${window.location.pathname}#${encoded}`)
    }, 500)
    return () => clearTimeout(timer)
  }, [code, config, optLevel, language, defines])

  const handleShare = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/shorten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: { code, config, optLevel, language, defines } }),
      })
      const data = await response.json()
      if (data.id) {
        const url = `${window.location.origin}${window.location.pathname}?s=${data.id}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code, config, optLevel, language, defines])

  // Apply error markers (red squiggles) for compile errors
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    // Clear existing markers
    monaco.editor.setModelMarkers(model, 'cache-explorer', [])

    if (!error || !error.errors || error.errors.length === 0) return

    // Create markers for each error
    const markers: editor.IMarkerData[] = error.errors.map(err => ({
      severity: err.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
      message: err.message + (err.suggestion ? `\n\nHint: ${err.suggestion}` : ''),
      startLineNumber: err.line,
      startColumn: err.column,
      endLineNumber: err.line,
      // Estimate end column: find the end of the problematic token/line
      endColumn: err.column + (err.sourceLine
        ? Math.min(20, err.sourceLine.length - err.column + 1)
        : 10),
      source: 'Cache Explorer'
    }))

    monaco.editor.setModelMarkers(model, 'cache-explorer', markers)
  }, [error])

  // Apply decorations for cache analysis results
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !result) {
      if (editorRef.current && decorationsRef.current.length > 0) {
        decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const decorations: editor.IModelDeltaDecoration[] = []

    for (const line of result.hotLines) {
      const fileName = line.file.split('/').pop() || line.file
      if (fileName.includes('cache-explorer') || fileName.startsWith('/tmp/')) {
        const lineNum = line.line
        if (lineNum > 0 && lineNum <= model.getLineCount()) {
          let className = 'line-good'
          let inlineClass = 'inline-good'
          if (line.missRate > 0.5) {
            className = 'line-bad'
            inlineClass = 'inline-bad'
          } else if (line.missRate > 0.2) {
            className = 'line-warn'
            inlineClass = 'inline-warn'
          }

          // Background highlight for the whole line
          decorations.push({
            range: new monaco.Range(lineNum, 1, lineNum, 1),
            options: {
              isWholeLine: true,
              className,
              glyphMarginClassName: className.replace('line-', 'glyph-'),
              glyphMarginHoverMessage: {
                value: `**${line.misses.toLocaleString()} misses** (${(line.missRate * 100).toFixed(1)}% miss rate)\n\n${line.hits.toLocaleString()} hits total`
              }
            }
          })

          // Inline annotation at end of line showing miss info
          const lineContent = model.getLineContent(lineNum)
          decorations.push({
            range: new monaco.Range(lineNum, lineContent.length + 1, lineNum, lineContent.length + 1),
            options: {
              after: {
                content: ` // ${line.misses} misses (${(line.missRate * 100).toFixed(0)}%)`,
                inlineClassName: inlineClass
              }
            }
          })
        }
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations)
  }, [result])

  const cancelAnalysis = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStage('idle')
    setLongRunning(false)
  }, [])

  const runAnalysis = () => {
    // Input validation - check total size across all files
    const totalSize = files.reduce((sum, f) => sum + f.code.length, 0)
    if (totalSize > 100000) {
      setError({ type: 'validation_error', message: 'Code too long (max 100KB total)', suggestion: 'Try smaller programs or use sampling' })
      return
    }
    if (files.every(f => f.code.trim().length === 0)) {
      setError({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    // Cancel any ongoing analysis
    cancelAnalysis()

    setStage('connecting')
    setError(null)
    setResult(null)
    setLongRunning(false)

    // Set long-running warning after 10 seconds
    const longRunTimeout = setTimeout(() => setLongRunning(true), 10000)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      const payload: Record<string, unknown> = { config, optLevel }
      // Send files array for multi-file support, single code for backward compatibility
      if (files.length === 1) {
        payload.code = files[0].code
        payload.language = files[0].language
      } else {
        payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
        payload.language = files[0].language // Primary language for compilation
      }
      if (config === 'custom') payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
      if (sampleRate > 1) payload.sample = sampleRate
      if (eventLimit > 0) payload.limit = eventLimit
      if (selectedCompiler) payload.compiler = selectedCompiler
      if (fastMode) payload.fast = true
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'result') {
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setResult(msg.data as CacheResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        // Handle all error types: 'error', 'compile_error', 'linker_error', etc.
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setError(msg as ErrorResult)
        setStage('idle')
        wsRef.current = null
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stage !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      wsRef.current = null
      setStage('compiling')

      // Create abort controller for HTTP request
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const payload: Record<string, unknown> = { config, optLevel }
        // Send files array for multi-file support, single code for backward compatibility
        if (files.length === 1) {
          payload.code = files[0].code
          payload.language = files[0].language
        } else {
          payload.files = files.map(f => ({ name: f.name, code: f.code, language: f.language }))
          payload.language = files[0].language
        }
        if (config === 'custom') payload.customConfig = customConfig
        if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
        if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
        if (sampleRate > 1) payload.sample = sampleRate
        if (eventLimit > 0) payload.limit = eventLimit
        if (fastMode) payload.fast = true

        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Request was cancelled - don't set error
          return
        }
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        abortControllerRef.current = null
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'
  const stageText = { idle: '', connecting: 'Connecting...', preparing: 'Preparing...', compiling: 'Compiling...', running: 'Running...', processing: 'Processing...', done: '' }

  // Export functions
  const exportAsJSON = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cache-analysis-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportAsCSV = () => {
    if (!result) return
    const lines: string[] = ['Metric,Value']
    const l1 = result.levels.l1d || result.levels.l1
    if (l1) {
      lines.push(`L1 Hits,${l1.hits}`)
      lines.push(`L1 Misses,${l1.misses}`)
      lines.push(`L1 Hit Rate,${(l1.hitRate * 100).toFixed(2)}%`)
    }
    if (result.levels.l2) {
      lines.push(`L2 Hits,${result.levels.l2.hits}`)
      lines.push(`L2 Misses,${result.levels.l2.misses}`)
      lines.push(`L2 Hit Rate,${(result.levels.l2.hitRate * 100).toFixed(2)}%`)
    }
    if (result.levels.l3) {
      lines.push(`L3 Hits,${result.levels.l3.hits}`)
      lines.push(`L3 Misses,${result.levels.l3.misses}`)
      lines.push(`L3 Hit Rate,${(result.levels.l3.hitRate * 100).toFixed(2)}%`)
    }
    if (result.timing) {
      lines.push(`Total Cycles,${result.timing.totalCycles}`)
      lines.push(`Avg Latency,${result.timing.avgLatency.toFixed(2)}`)
    }
    lines.push(`Total Events,${result.events}`)
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cache-analysis-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Batch analysis - compare same code across multiple hardware presets
  const runBatchAnalysis = async () => {
    const configs = ['educational', 'intel', 'amd', 'apple']
    setBatchResults([])
    setBatchRunning(true)
    setShowBatchModal(true)

    for (const cfg of configs) {
      try {
        const payload = {
          code: files.length > 1 ? files.map(f => f.code).join('\n// --- FILE SEPARATOR ---\n') : files[0].code,
          language: files[0].language,
          config: cfg,
          optLevel,
          prefetch: prefetchPolicy,
          sampleRate,
          eventLimit,
          fastMode,
        }
        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await response.json()
        if (data.levels) {
          setBatchResults(prev => [...prev, { config: cfg, result: data as CacheResult }])
        }
      } catch {
        // Skip failed configs
      }
    }
    setBatchRunning(false)
  }

  const commands: CommandItem[] = useMemo(() => [
    // Actions (@)
    { id: 'run', icon: '@', label: 'Run analysis', shortcut: '⌘R', action: () => { if (!isLoading) runAnalysis() }, category: 'actions' },
    { id: 'share', icon: '@', label: 'Share / Copy link', shortcut: '⌘S', action: () => { handleShare(); setCopied(true); setTimeout(() => setCopied(false), 2000) }, category: 'actions' },
    { id: 'diff-baseline', icon: '@', label: 'Set as diff baseline', action: () => { setBaselineCode(code); setBaselineResult(result) }, category: 'actions' },
    { id: 'diff-toggle', icon: '@', label: diffMode ? 'Exit diff mode' : 'Enter diff mode', action: () => { if (baselineCode) setDiffMode(!diffMode) }, category: 'actions' },
    { id: 'diff-clear', icon: '@', label: 'Clear diff baseline', action: () => { setBaselineCode(null); setBaselineResult(null); setDiffMode(false) }, category: 'actions' },
    { id: 'export-json', icon: '@', label: 'Export results as JSON', action: exportAsJSON, category: 'actions' },
    { id: 'export-csv', icon: '@', label: 'Export results as CSV', action: exportAsCSV, category: 'actions' },
    { id: 'batch-analyze', icon: '@', label: 'Compare hardware presets', action: runBatchAnalysis, category: 'actions' },
    // Settings (:)
    { id: 'vim', icon: ':', label: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', action: () => setVimMode(!vimMode), category: 'settings' },
    { id: 'lang-c', icon: ':', label: 'Language: C', action: () => updateActiveLanguage('c'), category: 'settings' },
    { id: 'lang-cpp', icon: ':', label: 'Language: C++', action: () => updateActiveLanguage('cpp'), category: 'settings' },
    { id: 'lang-rust', icon: ':', label: 'Language: Rust', action: () => updateActiveLanguage('rust'), category: 'settings' },
    // Config (*)
    { id: 'sampling-none', icon: '*', label: 'Sampling: All events', action: () => setSampleRate(1), category: 'config' },
    { id: 'sampling-10', icon: '*', label: 'Sampling: 1:10', action: () => setSampleRate(10), category: 'config' },
    { id: 'sampling-100', icon: '*', label: 'Sampling: 1:100', action: () => setSampleRate(100), category: 'config' },
    { id: 'limit-1m', icon: '*', label: 'Event limit: 1M', action: () => setEventLimit(1000000), category: 'config' },
    { id: 'limit-5m', icon: '*', label: 'Event limit: 5M', action: () => setEventLimit(5000000), category: 'config' },
    { id: 'limit-none', icon: '*', label: 'Event limit: None', action: () => setEventLimit(0), category: 'config' },
  ], [isLoading, activeFileId, vimMode, diffMode, baselineCode, code, result, handleShare, updateActiveLanguage])

  // Command palette handlers
  const handleCommandSelect = useCallback((cmd: CommandItem) => {
    cmd.action()
    setShowCommandPalette(false)
  }, [])

  const handleCommandNavigate = useCallback((delta: number) => {
    const filtered = commandQuery
      ? commands.filter(cmd => fuzzyMatch(commandQuery, cmd.label) || fuzzyMatch(commandQuery, cmd.category || ''))
      : commands
    setSelectedCommandIndex(prev => Math.max(0, Math.min(filtered.length - 1, prev + delta)))
  }, [commandQuery, commands])

  return (
    <div className={`app${isEmbedMode ? ' embed' : ''}`}>
      {/* Command Palette - hidden in embed mode */}
      {!isEmbedMode && (
        <CommandPalette
          isOpen={showCommandPalette}
          query={commandQuery}
          selectedIndex={selectedCommandIndex}
          onQueryChange={setCommandQuery}
          onSelect={handleCommandSelect}
          onClose={() => setShowCommandPalette(false)}
          onNavigate={handleCommandNavigate}
          inputRef={commandInputRef}
          commands={commands}
        />
      )}

      {/* Batch Results Modal */}
      {showBatchModal && (
        <div className="batch-modal-overlay" onClick={() => !batchRunning && setShowBatchModal(false)}>
          <div className="batch-modal" onClick={e => e.stopPropagation()}>
            <div className="batch-modal-header">
              <span className="batch-modal-title">Hardware Comparison</span>
              <button className="batch-modal-close" onClick={() => setShowBatchModal(false)}>×</button>
            </div>
            <div className="batch-modal-content">
              {batchRunning && batchResults.length < 4 && (
                <div className="batch-loading">
                  <span className="loading-spinner" />
                  Analyzing... ({batchResults.length}/4 complete)
                </div>
              )}
              {batchResults.length > 0 && (
                <table className="batch-results-table">
                  <thead>
                    <tr>
                      <th>Hardware</th>
                      <th>L1 Hit Rate</th>
                      <th>L2 Hit Rate</th>
                      <th>Cycles</th>
                      <th>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map(({ config, result: r }) => {
                      const l1 = r.levels.l1d || r.levels.l1
                      return (
                        <tr key={config}>
                          <td className="config-name">{config.charAt(0).toUpperCase() + config.slice(1)}</td>
                          <td className={l1 && l1.hitRate > 0.9 ? 'good' : 'warning'}>{l1 ? formatPercent(l1.hitRate) : '-'}</td>
                          <td className={r.levels.l2?.hitRate && r.levels.l2.hitRate > 0.9 ? 'good' : 'warning'}>{r.levels.l2 ? formatPercent(r.levels.l2.hitRate) : '-'}</td>
                          <td>{r.timing?.totalCycles.toLocaleString() || '-'}</td>
                          <td>{r.events.toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header - hidden in embed mode */}
      {!isEmbedMode && (
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <div className="logo-mark">
                <div className="logo-layer l3"></div>
                <div className="logo-layer l2"></div>
                <div className="logo-layer l1"></div>
              </div>
              <span className="logo-title">Cache Explorer</span>
            </div>
          </div>

          <div className="header-center">
            {diffMode && baselineResult && (
              <div className="diff-mode-badge" title="Comparing against baseline">
                <span className="diff-mode-icon">⇄</span>
                <span className="diff-mode-text">Diff Mode</span>
                <button className="diff-mode-exit" onClick={() => setDiffMode(false)} title="Exit diff mode">×</button>
              </div>
            )}
          </div>

          <div className="header-right">
            <button
              className="btn-icon"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>

            {/* Compare button - visible when result exists */}
            {result && !isLoading && (
              <button
                onClick={() => {
                  if (!baselineResult) {
                    // Set current as baseline
                    setBaselineCode(code)
                    setBaselineResult(result)
                  } else if (diffMode) {
                    // Exit diff mode
                    setDiffMode(false)
                  } else {
                    // Enter diff mode
                    setDiffMode(true)
                  }
                }}
                className={`btn-compare ${baselineResult ? (diffMode ? 'active' : 'has-baseline') : ''}`}
                title={!baselineResult ? 'Set current result as baseline for comparison' : diffMode ? 'Exit comparison mode' : 'Compare with baseline'}
              >
                {!baselineResult ? 'Set Baseline' : diffMode ? 'Exit Compare' : 'Compare'}
              </button>
            )}
            {baselineResult && !diffMode && (
              <button
                onClick={() => { setBaselineCode(null); setBaselineResult(null); setDiffMode(false) }}
                className="btn-icon btn-clear-baseline"
                title="Clear baseline"
              >
                ×
              </button>
            )}

            {/* Export dropdown */}
            {result && !isLoading && (
              <div className="export-dropdown">
                <button className="btn-export" title="Export results">
                  Export
                </button>
                <div className="export-menu">
                  <button onClick={exportAsJSON}>JSON</button>
                  <button onClick={exportAsCSV}>CSV</button>
                </div>
              </div>
            )}

            {isLoading ? (
              <button
                onClick={cancelAnalysis}
                className="btn-cancel"
                title="Cancel analysis"
              >
                <span className="btn-spinner" />
                {stageText[stage]}
                <span className="cancel-x">×</span>
              </button>
            ) : (
              <button
                onClick={runAnalysis}
                className="btn-primary"
              >
                Execute
              </button>
            )}
          </div>
        </header>
      )}

      {/* Settings Toolbar - Godbolt style */}
      {!isEmbedMode && (
        <SettingsToolbar
          config={config}
          optLevel={optLevel}
          prefetchPolicy={prefetchPolicy}
          compilers={compilers}
          selectedCompiler={selectedCompiler}
          defines={defines}
          customConfig={customConfig}
          eventLimit={eventLimit}
          sampleRate={sampleRate}
          fastMode={fastMode}
          onConfigChange={(c) => {
            setConfig(c)
            setPrefetchPolicy(PREFETCH_DEFAULTS[c] || 'none')
          }}
          onOptLevelChange={setOptLevel}
          onPrefetchChange={(p) => setPrefetchPolicy(p as PrefetchPolicy)}
          onCompilerChange={setSelectedCompiler}
          onDefinesChange={setDefines}
          onCustomConfigChange={setCustomConfig}
          onEventLimitChange={setEventLimit}
          onSampleRateChange={setSampleRate}
          onFastModeChange={setFastMode}
        />
      )}

      {/* Copied Toast */}
      {copied && (
        <div className="toast">Link copied!</div>
      )}

      {/* Mobile Tab Switcher */}
      {isMobile && !isEmbedMode && (
        <div className="mobile-tab-switcher">
          <button
            className={mobilePane === 'editor' ? 'active' : ''}
            onClick={() => setMobilePane('editor')}
          >
            Code
          </button>
          <button
            className={mobilePane === 'results' ? 'active' : ''}
            onClick={() => setMobilePane('results')}
          >
            Results
          </button>
        </div>
      )}

      <div className="workspace">
        {/* Sidebar - Example List */}
        {!isEmbedMode && !isMobile && (
          <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
            <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? 'Show examples' : 'Hide examples'}>
              {sidebarCollapsed ? '›' : '‹'}
            </button>
            {!sidebarCollapsed && (
              <div className="sidebar-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div className="sidebar-title">Examples</div>
                <div className="language-filter">
                  <button
                    className={`language-filter-btn${exampleLangFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setExampleLangFilter('all')}
                  >All</button>
                  <button
                    className={`language-filter-btn${exampleLangFilter === 'c' ? ' active' : ''}`}
                    onClick={() => setExampleLangFilter('c')}
                  >C</button>
                  <button
                    className={`language-filter-btn${exampleLangFilter === 'cpp' ? ' active' : ''}`}
                    onClick={() => setExampleLangFilter('cpp')}
                  >C++</button>
                </div>
                <div className="example-list" style={{ flex: 1, overflowY: 'auto' }}>
                  {Object.entries(EXAMPLES)
                    .filter(([, ex]) => exampleLangFilter === 'all' || ex.language === exampleLangFilter)
                    .map(([key, ex]) => (
                    <button
                      key={key}
                      className={`example-item${files[0]?.code === ex.code ? ' active' : ''}`}
                      onClick={() => {
                        if (ex.files && ex.files.length > 0) {
                          const newFiles = ex.files.map((f) => ({
                            id: generateFileId(),
                            name: f.name,
                            code: f.code,
                            language: f.language,
                            isMain: f.isMain
                          }))
                          setFiles(newFiles)
                          const mainFile = newFiles.find(f => f.isMain) || newFiles[0]
                          setActiveFileId(mainFile.id)
                          setMainFileId(mainFile.id)
                        } else {
                          setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, code: ex.code, language: ex.language, name: 'main' + getFileExtension(ex.language) } : f))
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="example-name">{ex.name}</span>
                        <span className={`example-lang${ex.language === 'cpp' ? ' cpp' : ''}`}>{ex.language === 'cpp' ? 'C++' : 'C'}</span>
                      </div>
                      <span className="example-desc">{ex.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}

        <div className={`editor-area${isMobile && mobilePane !== 'editor' ? ' mobile-hidden' : ''}`}>
          {/* Tab Bar */}
          {!isEmbedMode && (
            <div className="tab-bar">
              <FileManager
                files={projectFiles}
                activeFileId={activeFileId}
                onFileSelect={setActiveFileId}
                onFileCreate={createFile}
                onFileDelete={closeFile}
                onFileRename={renameFile}
                onSetMainFile={setMainFileId}
              />
            </div>
          )}

          <div className="editor-container">
            {diffMode && baselineCode ? (
              <>
                <div className="diff-labels">
                  <span className="diff-label baseline">BASELINE (Original)</span>
                  <span className="diff-label current">CURRENT (Modified)</span>
                </div>
                <DiffEditor
                  height="calc(100% - 28px)"
                  language={monacoLanguage}
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  original={baselineCode}
                  modified={code}
                  onMount={(editor) => {
                    const modifiedEditor = editor.getModifiedEditor()
                    modifiedEditor.onDidChangeModelContent(() => updateActiveCode(modifiedEditor.getValue()))
                  }}
                  options={{ minimap: { enabled: false }, fontSize: 13, renderSideBySide: true, readOnly: isReadOnly }}
                />
              </>
            ) : (
              <Editor
                height="100%"
                language={monacoLanguage}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={code}
                onChange={(value) => !isReadOnly && updateActiveCode(value || '')}
                onMount={handleEditorMount}
                options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true, readOnly: isReadOnly }}
              />
            )}
          </div>

          {/* Status Bar */}
          {!isEmbedMode && (
            <div className="status-bar">
              <div className="status-bar-left">
                <span className="status-item">
                  <span className={`status-indicator ${isLoading ? 'running' : 'idle'}`} />
                  {isLoading ? stageText[stage] : 'Ready'}
                </span>
                <span className="status-item">{language.toUpperCase()}</span>
              </div>
              <div className="status-bar-right">
                {vimMode && <span className="status-item">VIM</span>}
                <span className="status-item">{config}</span>
              </div>
            </div>
          )}
          {vimMode && !isEmbedMode && <div ref={vimStatusRef} className="vim-status-bar" />}
        </div>

        <div className={`results-panel${isMobile && mobilePane !== 'results' ? ' mobile-hidden' : ''}`}>
          <div className="results-header">
            <span className="results-title">Analysis Results</span>
            {result && (
              <button className="btn" onClick={handleShare} title="Copy link">
                {copied ? 'Copied!' : 'Share'}
              </button>
            )}
          </div>
          <div className="results-scroll">
            {error && <ErrorDisplay error={error} />}

            {result && (
              <>
                {/* Diff Summary Panel */}
                {diffMode && baselineResult && (
                  <div className="diff-summary panel">
                    <div className="panel-header">
                      <span className="panel-title">Comparison Summary</span>
                    </div>
                    <div className="diff-summary-content">
                      {(() => {
                        const l1Cur = (result.levels.l1d || result.levels.l1!).hitRate
                        const l1Base = (baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate ?? 0
                        const l1Diff = l1Cur - l1Base
                        const cyclesCur = result.timing?.totalCycles ?? 0
                        const cyclesBase = baselineResult.timing?.totalCycles ?? 0
                        const cyclesDiff = cyclesBase > 0 ? ((cyclesCur - cyclesBase) / cyclesBase * 100) : 0
                        const improved = l1Diff > 0.01 || cyclesDiff < -5
                        const degraded = l1Diff < -0.01 || cyclesDiff > 5
                        return (
                          <div className={`diff-verdict ${improved ? 'improved' : degraded ? 'degraded' : 'neutral'}`}>
                            <span className="diff-verdict-icon">{improved ? '↑' : degraded ? '↓' : '='}</span>
                            <span className="diff-verdict-text">
                              {improved ? 'Performance Improved' : degraded ? 'Performance Degraded' : 'Similar Performance'}
                            </span>
                          </div>
                        )
                      })()}
                      <div className="diff-details">
                        <div className="diff-detail">
                          <span>L1 Hit Rate:</span>
                          <span>{formatPercent((result.levels.l1d || result.levels.l1!).hitRate)} vs {formatPercent((baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate ?? 0)}</span>
                        </div>
                        {result.timing && baselineResult.timing && (
                          <div className="diff-detail">
                            <span>Cycles:</span>
                            <span>{result.timing.totalCycles.toLocaleString()} vs {baselineResult.timing.totalCycles.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="diff-detail">
                          <span>Events:</span>
                          <span>{result.events.toLocaleString()} vs {baselineResult.events.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Metric Cards */}
                <div className="metric-grid">
                  {(() => {
                    const l1Rate = (result.levels.l1d || result.levels.l1!).hitRate
                    const l1Baseline = baselineResult ? (baselineResult.levels.l1d || baselineResult.levels.l1!)?.hitRate : null
                    const l1Delta = diffMode && l1Baseline != null ? formatDelta(l1Rate, l1Baseline) : null
                    return (
                      <div className={`metric-card ${l1Rate > 0.95 ? 'excellent' : l1Rate > 0.8 ? 'good' : 'warning'}`}>
                        <div className="metric-label">L1 Hit Rate</div>
                        <div className="metric-value">
                          {formatPercent(l1Rate)}
                          {l1Delta && !l1Delta.isNeutral && (
                            <span className={`metric-delta ${l1Delta.isPositive ? 'positive' : 'negative'}`}>
                              {l1Delta.text}
                            </span>
                          )}
                        </div>
                        <div className="metric-detail">
                          {(result.levels.l1d || result.levels.l1!).hits.toLocaleString()} hits
                        </div>
                      </div>
                    )
                  })()}
                  {(() => {
                    const l2Rate = result.levels.l2.hitRate
                    const l2Baseline = baselineResult?.levels.l2?.hitRate
                    const l2Delta = diffMode && l2Baseline != null ? formatDelta(l2Rate, l2Baseline) : null
                    return (
                      <div className={`metric-card ${l2Rate > 0.95 ? 'excellent' : l2Rate > 0.8 ? 'good' : 'warning'}`}>
                        <div className="metric-label">L2 Hit Rate</div>
                        <div className="metric-value">
                          {formatPercent(l2Rate)}
                          {l2Delta && !l2Delta.isNeutral && (
                            <span className={`metric-delta ${l2Delta.isPositive ? 'positive' : 'negative'}`}>
                              {l2Delta.text}
                            </span>
                          )}
                        </div>
                        <div className="metric-detail">{result.levels.l2.hits.toLocaleString()} hits</div>
                      </div>
                    )
                  })()}
                  {(() => {
                    const l3Rate = result.levels.l3.hitRate
                    const l3Baseline = baselineResult?.levels.l3?.hitRate
                    const l3Delta = diffMode && l3Baseline != null ? formatDelta(l3Rate, l3Baseline) : null
                    return (
                      <div className={`metric-card ${l3Rate > 0.95 ? 'excellent' : l3Rate > 0.8 ? 'good' : 'warning'}`}>
                        <div className="metric-label">L3 Hit Rate</div>
                        <div className="metric-value">
                          {formatPercent(l3Rate)}
                          {l3Delta && !l3Delta.isNeutral && (
                            <span className={`metric-delta ${l3Delta.isPositive ? 'positive' : 'negative'}`}>
                              {l3Delta.text}
                            </span>
                          )}
                        </div>
                        <div className="metric-detail">{result.levels.l3.hits.toLocaleString()} hits</div>
                      </div>
                    )
                  })()}
                </div>

                {/* Cache Hierarchy Visualization */}
                <div className="cache-hierarchy">
                  <div className="cache-hierarchy-title">Cache Hierarchy</div>
                  <div className="cache-levels">
                    <CacheHierarchyLevel
                      name="L1"
                      hitRate={(result.levels.l1d || result.levels.l1!).hitRate}
                    />
                    <div className="cache-connector" />
                    <CacheHierarchyLevel
                      name="L2"
                      hitRate={result.levels.l2.hitRate}
                    />
                    {/* Only show L3 if the config has an L3 cache (e.g., not on RPi4) */}
                    {(result.cacheConfig?.l3?.sizeKB ?? 0) > 0 && (
                      <>
                        <div className="cache-connector" />
                        <CacheHierarchyLevel
                          name="L3"
                          hitRate={result.levels.l3.hitRate}
                        />
                      </>
                    )}
                    <div className="cache-connector" />
                    {(() => {
                      // DRAM accesses = L3 misses when L3 exists, L2 misses when no L3 (e.g., RPi4)
                      const hasL3 = (result.cacheConfig?.l3?.sizeKB ?? 0) > 0
                      const dramAccesses = hasL3 ? result.levels.l3.misses : result.levels.l2.misses
                      const baselineDram = baselineResult
                        ? ((baselineResult.cacheConfig?.l3?.sizeKB ?? 0) > 0
                            ? baselineResult.levels.l3?.misses
                            : baselineResult.levels.l2?.misses)
                        : null
                      const dramDelta = diffMode && baselineDram != null ? formatNumericDelta(dramAccesses, baselineDram) : null
                      return (
                        <div className="memory-stats">
                          <span className="memory-stats-label">DRAM</span>
                          <span className="memory-stats-value">
                            {dramAccesses.toLocaleString()} accesses
                            {dramDelta && !dramDelta.isNeutral && (
                              <span className={`memory-delta ${dramDelta.isWorse ? 'worse' : 'better'}`}>
                                {dramDelta.text}
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                  {result.timing && (
                    <TimingDisplay
                      timing={result.timing}
                      baselineTiming={baselineResult?.timing}
                      diffMode={diffMode}
                    />
                  )}
                </div>

                {/* Prefetch Stats */}
                {result.prefetch && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">Prefetching: {result.prefetch.policy}</span>
                    </div>
                    <div className="panel-content">
                      <div className="metric-grid">
                        <div className="metric-card">
                          <div className="metric-label">Issued</div>
                          <div className="metric-value">{result.prefetch.issued.toLocaleString()}</div>
                        </div>
                        <div className="metric-card">
                          <div className="metric-label">Useful</div>
                          <div className="metric-value">{result.prefetch.useful.toLocaleString()}</div>
                        </div>
                        <div className={`metric-card ${result.prefetch.accuracy > 0.5 ? 'excellent' : result.prefetch.accuracy > 0.2 ? 'good' : 'warning'}`}>
                          <div className="metric-label">Accuracy</div>
                          <div className="metric-value">{(result.prefetch.accuracy * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Advanced Stats */}
                {result.advancedStats && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">Advanced Instrumentation</span>
                    </div>
                    <div className="panel-content">
                      <div className="advanced-stats-grid">
                        {result.advancedStats.vector && (
                          <div className="advanced-stat-section">
                            <h4>Vector/SIMD Operations</h4>
                            <div className="stat-row">
                              <span>Loads:</span>
                              <span>{result.advancedStats.vector.loads.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                              <span>Stores:</span>
                              <span>{result.advancedStats.vector.stores.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                              <span>Bytes Loaded:</span>
                              <span>{(result.advancedStats.vector.bytesLoaded / 1024).toFixed(1)} KB</span>
                            </div>
                            <div className="stat-row">
                              <span>Bytes Stored:</span>
                              <span>{(result.advancedStats.vector.bytesStored / 1024).toFixed(1)} KB</span>
                            </div>
                            {result.advancedStats.vector.crossLineAccesses > 0 && (
                              <div className="stat-row warning">
                                <span>Cross-Line:</span>
                                <span>{result.advancedStats.vector.crossLineAccesses.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {result.advancedStats.atomic && (
                          <div className="advanced-stat-section">
                            <h4>Atomic Operations</h4>
                            <div className="stat-row">
                              <span>Loads:</span>
                              <span>{result.advancedStats.atomic.loads.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                              <span>Stores:</span>
                              <span>{result.advancedStats.atomic.stores.toLocaleString()}</span>
                            </div>
                            {result.advancedStats.atomic.rmw > 0 && (
                              <div className="stat-row">
                                <span>RMW (fetch_add, etc.):</span>
                                <span>{result.advancedStats.atomic.rmw.toLocaleString()}</span>
                              </div>
                            )}
                            {result.advancedStats.atomic.cmpxchg > 0 && (
                              <div className="stat-row">
                                <span>CAS:</span>
                                <span>{result.advancedStats.atomic.cmpxchg.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {result.advancedStats.memoryIntrinsics && (
                          <div className="advanced-stat-section">
                            <h4>Memory Intrinsics</h4>
                            {result.advancedStats.memoryIntrinsics.memcpyCount > 0 && (
                              <div className="stat-row">
                                <span>memcpy:</span>
                                <span>{result.advancedStats.memoryIntrinsics.memcpyCount.toLocaleString()} ({(result.advancedStats.memoryIntrinsics.memcpyBytes / 1024).toFixed(1)} KB)</span>
                              </div>
                            )}
                            {result.advancedStats.memoryIntrinsics.memsetCount > 0 && (
                              <div className="stat-row">
                                <span>memset:</span>
                                <span>{result.advancedStats.memoryIntrinsics.memsetCount.toLocaleString()} ({(result.advancedStats.memoryIntrinsics.memsetBytes / 1024).toFixed(1)} KB)</span>
                              </div>
                            )}
                            {result.advancedStats.memoryIntrinsics.memmoveCount > 0 && (
                              <div className="stat-row">
                                <span>memmove:</span>
                                <span>{result.advancedStats.memoryIntrinsics.memmoveCount.toLocaleString()} ({(result.advancedStats.memoryIntrinsics.memmoveBytes / 1024).toFixed(1)} KB)</span>
                              </div>
                            )}
                          </div>
                        )}
                        {result.advancedStats.softwarePrefetch && (
                          <div className="advanced-stat-section">
                            <h4>Software Prefetch</h4>
                            <div className="stat-row">
                              <span>Issued:</span>
                              <span>{result.advancedStats.softwarePrefetch.issued.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                              <span>Useful:</span>
                              <span>{result.advancedStats.softwarePrefetch.useful.toLocaleString()}</span>
                            </div>
                            <div className="stat-row">
                              <span>Accuracy:</span>
                              <span>{(result.advancedStats.softwarePrefetch.accuracy * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Toggle Buttons */}
                <div className="toggle-buttons" style={{ margin: 'var(--space-4) 0' }}>
                  <button className={`btn ${showDetails ? 'active' : ''}`} onClick={() => setShowDetails(!showDetails)}>
                    {showDetails ? '▼ Details' : '▶ Details'}
                  </button>
                </div>

              {showDetails && (
                <>
                  <div className="details-grid">
                    <LevelDetail name="L1 Data" stats={result.levels.l1d || result.levels.l1!} />
                    {result.levels.l1i && <LevelDetail name="L1 Instruction" stats={result.levels.l1i} />}
                    <LevelDetail name="L2" stats={result.levels.l2} />
                    {(result.cacheConfig?.l3?.sizeKB ?? 0) > 0 && <LevelDetail name="L3" stats={result.levels.l3} />}
                  </div>
                  {result.tlb && (
                    <div className="tlb-grid">
                      <TLBDetail name="Data TLB" stats={result.tlb.dtlb} />
                      <TLBDetail name="Instruction TLB" stats={result.tlb.itlb} />
                    </div>
                  )}
                </>
              )}

              {result.coherence && result.coherence.falseSharingEvents > 0 && (
                <div className="panel warning">
                  <div className="panel-header">
                    <span className="panel-title">False Sharing Detected</span>
                    <span className="panel-badge">{result.coherence.falseSharingEvents}</span>
                  </div>
                </div>
              )}

              {result.falseSharing && result.falseSharing.length > 0 && (
                <FalseSharingViz
                  falseSharing={result.falseSharing}
                  lineSize={result.cacheConfig?.l1d?.lineSize || 64}
                />
              )}

              {(() => {
                // Filter hotlines to only show those with more than 1 total access
                const significantHotLines = result.hotLines.filter(h => (h.hits + h.misses) > 1)
                return significantHotLines.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Hot Lines</span>
                    <span className="panel-badge">{significantHotLines.length}</span>
                  </div>
                  {/* File filter dropdown - only show if multiple files */}
                  {(() => {
                    const uniqueFiles = new Set(significantHotLines.map(h => h.file).filter(Boolean))
                    return uniqueFiles.size > 1 ? (
                      <div className="file-filter" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                        <label htmlFor="hot-line-file-select" style={{ marginRight: '8px', fontSize: '12px' }}>Filter by file:</label>
                        <select
                          id="hot-line-file-select"
                          value={selectedHotLineFile}
                          onChange={(e) => setSelectedHotLineFile(e.target.value)}
                          style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                        >
                          <option value="">All files</option>
                          {Array.from(uniqueFiles).sort().map(file => (
                            <option key={file} value={file}>{file?.split('/').pop()}</option>
                          ))}
                        </select>
                      </div>
                    ) : null
                  })()}
                  <div className="hotspots">
                    {(() => {
                      const filteredLines = significantHotLines.filter(h => !selectedHotLineFile || h.file === selectedHotLineFile)
                      const maxMisses = Math.max(...filteredLines.slice(0, 10).map(h => h.misses), 1)
                      return filteredLines.slice(0, 10).map((hotLine, i) => {
                        const barWidth = maxMisses > 0 ? (hotLine.misses / maxMisses) * 100 : 0
                        return (
                          <div
                            key={i}
                            className="hotspot"
                            onClick={() => {
                              if (editorRef.current && hotLine.line > 0) {
                                editorRef.current.revealLineInCenter(hotLine.line)
                                editorRef.current.setPosition({ lineNumber: hotLine.line, column: 1 })
                                editorRef.current.focus()
                              }
                            }}
                          >
                            <div className="hotspot-header">
                              <span className="hotspot-location">
                                {hotLine.file ? `${hotLine.file.split('/').pop()}:` : ''}Line {hotLine.line}
                              </span>
                              <span className="hotspot-stats">
                                {hotLine.misses.toLocaleString()} misses ({formatPercent(hotLine.missRate)})
                              </span>
                            </div>
                            {/* Source code preview */}
                            {(() => {
                              const lines = code.split('\n')
                              const sourceLine = lines[hotLine.line - 1]?.trim()
                              return sourceLine ? (
                                <div className="hotspot-code">
                                  <code>{sourceLine}</code>
                                </div>
                              ) : null
                            })()}
                            <div className="hotspot-bar">
                              <div
                                className="hotspot-bar-fill"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              )})()}

              {result.suggestions && result.suggestions.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Optimization Suggestions</span>
                    <span className="panel-badge">{result.suggestions.length}</span>
                  </div>
                  <div className="suggestions">
                    {result.suggestions.map((s, i) => (
                      <div key={i} className={`suggestion ${s.severity}`}>
                        <div className="suggestion-header">
                          <span className={`suggestion-severity ${s.severity}`}>{s.severity}</span>
                          {s.location && <span className="suggestion-location">{formatLocation(s.location)}</span>}
                        </div>
                        <div className="suggestion-message">{s.message}</div>
                        {s.fix && <div className="suggestion-fix">{s.fix}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.cacheState && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">L1 Cache Grid</span>
                    <span className="panel-badge">Final State</span>
                  </div>
                  <CacheGrid
                    cacheState={result.cacheState}
                    coreCount={result.cores || 1}
                  />
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="loading-state">
              <div className="loading-spinner" />
              <div className="loading-text">{stageText[stage]}</div>
              {longRunning && (
                <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--signal-warning)' }}>
                  Taking longer than expected. Try enabling sampling in Options.
                </div>
              )}
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="empty-state">
              <div className="empty-state-logo">
                <div className="logo-layer l3"></div>
                <div className="logo-layer l2"></div>
                <div className="logo-layer l1"></div>
              </div>
              <div className="empty-state-title">Ready to Analyze</div>
              <div className="empty-state-desc">
                Write or paste C/C++ code in the editor, then execute to visualize cache behavior.
              </div>
              <div className="empty-state-shortcut">
                Press <kbd>⌘</kbd>+<kbd>Enter</kbd> to run
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

    </div>
  )
}

export default App
