import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import LZString from 'lz-string'
import './App.css'

// Import hooks
import {
  useAnalysisState,
  useConfigState,
  useTheme,
  useKeyboardShortcuts,
  useUrlState,
  shareUrl,
  useMobileResponsive,
  useEditorState
} from './hooks'

// Import visualization components
import {
  MemoryLayout,
  FileManager,
  AdvancedOptionsModal,
  ErrorDisplay,
  CacheHierarchyDisplay,
  CacheStatsDisplay,
  FalseSharingDisplay,
  CacheHierarchyVisualization,
  AccessTimelineDisplay,
  CommandPalette,
  QuickConfigPanel,
  LevelDetail,
  TLBDetail
} from './components'
import type { ProjectFile, CommandItem } from './components'

// Import constants and types
import { PREFETCH_DEFAULTS } from './constants/config'
import type { PrefetchPolicy } from './types'

// API base URL - in production (Docker), use relative paths; in dev, use localhost
const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001'
const WS_URL = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : 'ws://localhost:3001/ws'

interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  writebacks: number
}

interface TLBStats {
  hits: number
  misses: number
  hitRate: number
}

interface TLBHierarchyStats {
  dtlb: TLBStats
  itlb: TLBStats
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

// Timeline event from streaming progress
interface TimelineEvent {
  i: number       // event index
  t: 'R' | 'W' | 'I'  // type: Read, Write, Instruction fetch
  l: 1 | 2 | 3 | 4    // hit level: 1=L1, 2=L2, 3=L3, 4=memory
  a?: number      // memory address (for cache visualization)
  f?: string      // file (optional)
  n?: number      // line number (optional)
}

interface PrefetchStats {
  policy: string
  degree: number
  issued: number
  useful: number
  accuracy: number
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
  timeline?: TimelineEvent[]  // collected timeline events
  prefetch?: PrefetchStats
  cacheState?: CacheState
  tlb?: TLBHierarchyStats
}

type Language = 'c' | 'cpp' | 'rust'

interface FileTab {
  id: string
  name: string
  code: string
  language: Language
}

interface Example {
  name: string
  code: string
  description: string
  language: Language
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
}

// Helper functions are now in utils/file.ts and imported via hooks

function formatPercent(rate: number): string {
  return (rate * 100).toFixed(1) + '%'
}

// Fuzzy match helper - used by command palette and App
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
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


type Stage = 'idle' | 'connecting' | 'preparing' | 'compiling' | 'running' | 'processing' | 'done'

// Types are now imported from './types' via hooks and components

function App() {
  // Embed mode detection from URL params
  const urlParams = new URLSearchParams(window.location.search)
  const isEmbedMode = urlParams.get('embed') === 'true'
  const isReadOnly = urlParams.get('readonly') === 'true'

  // Use extracted hooks for state management
  const analysisState = useAnalysisState()
  const configState = useConfigState()
  const { theme, toggleTheme } = useTheme()
  const { isMobile, mobilePane, setMobilePane } = useMobileResponsive()

  // Derived properties from hooks
  const { code, language } = analysisState
  const { config, optLevel, prefetchPolicy, customConfig, defines, sampleRate, eventLimit, selectedCompiler, compilers } = configState

  // Convert files to ProjectFile format for FileManager
  const projectFiles: ProjectFile[] = useMemo(() =>
    analysisState.files.map(f => ({
      id: f.id,
      name: f.name,
      code: f.code,
      language: f.language,
      isMain: f.id === analysisState.mainFileId
    }))
  , [analysisState.files, analysisState.mainFileId])

  // Remaining state - analysis specific
  const [result, setResult] = useState<CacheResult | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<ErrorResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)  // For interactive cache grid
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [showQuickConfig, setShowQuickConfig] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineEvent[]>([])  // Accumulator during streaming
  const optionsRef = useRef<HTMLDivElement>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  // Editor state management (refs, Vim mode, decorations)
  const editorState = useEditorState(
    vimMode,
    error,
    result,
    timeline,
    scrubberIndex
  )

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Use keyboard shortcuts hook (mobile detection is handled by useMobileResponsive hook)
  useKeyboardShortcuts({
    onCommandPalette: () => {
      setShowCommandPalette(true)
      setCommandQuery('')
      setSelectedCommandIndex(0)
    },
    onRun: () => runAnalysis(),
    onEscape: () => {
      setShowOptions(false)
      setShowCommandPalette(false)
      setShowQuickConfig(false)
    },
    canRun: stage === 'idle'
  })

  // Use URL state hook for loading and syncing state
  useUrlState(
    (state) => {
      const lang = state.language || 'c'
      // Load state from URL into hooks
      analysisState.updateActiveCode(state.code)
      analysisState.updateActiveLanguage(lang)
      configState.setConfig(state.config)
      configState.setOptLevel(state.optLevel)
      if (state.defines) configState.setDefines(state.defines)
    },
    [code, config, optLevel, language, defines]
  )

  const handleShare = useCallback(async () => {
    try {
      const url = await shareUrl({
        code,
        config,
        optLevel,
        language,
        defines
      })
      if (url) {
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

  // Open current code in Compiler Explorer
  const openInCompilerExplorer = useCallback(() => {
    const sourceCode = code
    const lang = language

    // Map our language to CE compiler IDs
    const compilerMap: Record<string, string> = {
      c: 'cclang1800',      // Clang trunk for C
      cpp: 'clang1800',     // Clang trunk for C++
      rust: 'r1830'         // Rust stable
    }

    // Map our opt levels to CE format
    const optMap: Record<string, string> = {
      '-O0': '-O0',
      '-O1': '-O1',
      '-O2': '-O2',
      '-O3': '-O3',
      '-Os': '-Os',
      '-Oz': '-Oz'
    }

    // Build CE ClientState
    const ceState = {
      sessions: [{
        id: 1,
        language: lang === 'cpp' ? 'c++' : lang,
        source: sourceCode,
        compilers: [{
          id: compilerMap[lang] || 'cclang1800',
          options: optMap[optLevel] || '-O2'
        }]
      }]
    }

    // Compress using LZString with URL-safe encoding (CE uses this format)
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(ceState))
    const ceUrl = `https://godbolt.org/clientstate/${compressed}`
    window.open(ceUrl, '_blank', 'noopener,noreferrer')
  }, [code, language, optLevel])


  const runAnalysis = () => {
    // Input validation - check total size across all files
    const totalSize = analysisState.files.reduce((sum: number, f: FileTab) => sum + f.code.length, 0)
    if (totalSize > 100000) {
      setError({ type: 'validation_error', message: 'Code too long (max 100KB total)', suggestion: 'Try smaller programs or use sampling' })
      return
    }
    if (analysisState.files.every((f: FileTab) => f.code.trim().length === 0)) {
      setError({ type: 'validation_error', message: 'No code to analyze', suggestion: 'Write or paste some code first' })
      return
    }

    setStage('connecting')
    setError(null)
    setResult(null)
    setTimeline([])
    setLongRunning(false)
    timelineRef.current = []

    // Set long-running warning after 10 seconds
    const longRunTimeout = setTimeout(() => setLongRunning(true), 10000)

    const ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      const payload: Record<string, unknown> = { config, optLevel }
      // Send files array for multi-file support, single code for backward compatibility
      if (analysisState.files.length === 1) {
        payload.code = analysisState.files[0].code
        payload.language = analysisState.files[0].language
      } else {
        payload.files = analysisState.files.map(f => ({ name: f.name, code: f.code, language: f.language }))
        payload.language = analysisState.files[0].language // Primary language for compilation
      }
      if (config === 'custom') payload.customConfig = customConfig
      if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
      if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
      if (sampleRate > 1) payload.sample = sampleRate
      if (eventLimit > 0) payload.limit = eventLimit
      if (selectedCompiler) payload.compiler = selectedCompiler
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'status') setStage(msg.stage as Stage)
      else if (msg.type === 'progress') {
        // Collect timeline events from streaming progress
        if (msg.timeline && Array.isArray(msg.timeline)) {
          timelineRef.current = [...timelineRef.current, ...msg.timeline]
          // Update timeline state periodically (every 200 events)
          if (timelineRef.current.length % 200 < msg.timeline.length) {
            setTimeline([...timelineRef.current])
          }
        }
      } else if (msg.type === 'result') {
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        // Finalize timeline and set result
        setTimeline([...timelineRef.current])
        setResult({ ...(msg.data as CacheResult), timeline: timelineRef.current })
        setScrubberIndex(timelineRef.current.length)  // Start at end of timeline
        setStage('idle')
        ws.close()
      } else if (msg.type === 'error' || msg.type?.includes('error') || msg.errors) {
        // Handle all error types: 'error', 'compile_error', 'linker_error', etc.
        clearTimeout(longRunTimeout)
        setLongRunning(false)
        setError(msg as ErrorResult)
        setStage('idle')
        ws.close()
      }
    }

    ws.onerror = () => fallbackToHttp()
    ws.onclose = (e) => { if (!e.wasClean && stage !== 'idle') fallbackToHttp() }

    const fallbackToHttp = async () => {
      setStage('compiling')
      try {
        const payload: Record<string, unknown> = { config, optLevel }
        // Send files array for multi-file support, single code for backward compatibility
        if (analysisState.files.length === 1) {
          payload.code = analysisState.files[0].code
          payload.language = analysisState.files[0].language
        } else {
          payload.files = analysisState.files.map(f => ({ name: f.name, code: f.code, language: f.language }))
          payload.language = analysisState.files[0].language
        }
        if (config === 'custom') payload.customConfig = customConfig
        if (defines.length > 0) payload.defines = defines.filter(d => d.name.trim())
        if (prefetchPolicy !== 'none') payload.prefetch = prefetchPolicy
        if (sampleRate > 1) payload.sample = sampleRate
        if (eventLimit > 0) payload.limit = eventLimit

        const response = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (data.type || data.error) setError(data as ErrorResult)
        else if (data.levels) setResult(data as CacheResult)
        else setError({ type: 'unknown_error', message: 'Unexpected response' })
      } catch (err) {
        setError({ type: 'server_error', message: err instanceof Error ? err.message : 'Connection failed' })
      } finally {
        setStage('idle')
      }
    }
  }

  const isLoading = stage !== 'idle'
  const stageText = { idle: '', connecting: 'Connecting...', preparing: 'Preparing...', compiling: 'Compiling...', running: 'Running...', processing: 'Processing...', done: '' }

  // Config display names
  const configNames: Record<string, string> = {
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

  const commands: CommandItem[] = useMemo(() => [
    // Actions (@)
    { id: 'run', icon: '@', label: 'Run analysis', shortcut: '⌘R', action: () => { if (!isLoading) runAnalysis() }, category: 'actions' },
    { id: 'share', icon: '@', label: 'Share / Copy link', shortcut: '⌘S', action: () => { handleShare(); setCopied(true); setTimeout(() => setCopied(false), 2000) }, category: 'actions' },
    { id: 'ce', icon: '@', label: 'Open in Compiler Explorer', action: openInCompilerExplorer, category: 'actions' },
    { id: 'diff-baseline', icon: '@', label: 'Set as diff baseline', action: () => setBaselineCode(code), category: 'actions' },
    { id: 'diff-toggle', icon: '@', label: diffMode ? 'Exit diff mode' : 'Enter diff mode', action: () => { if (baselineCode) setDiffMode(!diffMode) }, category: 'actions' },
    // Examples (>) - dynamically generated from EXAMPLES
    ...Object.entries(EXAMPLES).map(([key, ex]) => ({
      id: `example-${key}`,
      icon: '>',
      label: ex.name,
      action: () => {
        analysisState.updateActiveCode(ex.code)
        analysisState.updateActiveLanguage(ex.language)
      },
      category: 'examples'
    })),
    // Settings (:)
    { id: 'vim', icon: ':', label: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', action: () => setVimMode(!vimMode), category: 'settings' },
    { id: 'lang-c', icon: ':', label: 'Language: C', action: () => analysisState.updateActiveLanguage('c'), category: 'settings' },
    { id: 'lang-cpp', icon: ':', label: 'Language: C++', action: () => analysisState.updateActiveLanguage('cpp'), category: 'settings' },
    { id: 'lang-rust', icon: ':', label: 'Language: Rust', action: () => analysisState.updateActiveLanguage('rust'), category: 'settings' },
    // Config (*)
    { id: 'config', icon: '*', label: 'Hardware config...', action: () => setShowQuickConfig(true), category: 'config' },
    { id: 'options', icon: '*', label: 'Advanced options...', action: () => setShowOptions(true), category: 'config' },
    { id: 'sampling-none', icon: '*', label: 'Sampling: All events', action: () => configState.setSampleRate(1), category: 'config' },
    { id: 'sampling-10', icon: '*', label: 'Sampling: 1:10', action: () => configState.setSampleRate(10), category: 'config' },
    { id: 'sampling-100', icon: '*', label: 'Sampling: 1:100', action: () => configState.setSampleRate(100), category: 'config' },
    { id: 'limit-1m', icon: '*', label: 'Event limit: 1M', action: () => configState.setEventLimit(1000000), category: 'config' },
    { id: 'limit-5m', icon: '*', label: 'Event limit: 5M', action: () => configState.setEventLimit(5000000), category: 'config' },
    { id: 'limit-none', icon: '*', label: 'Event limit: None', action: () => configState.setEventLimit(0), category: 'config' },
  ], [isLoading, analysisState.activeFileId, vimMode, diffMode, baselineCode, code, handleShare, openInCompilerExplorer, analysisState.updateActiveLanguage])

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

      {/* Quick Config Panel - hidden in embed mode */}
      {!isEmbedMode && (
        <QuickConfigPanel
          isOpen={showQuickConfig}
          config={config}
          optLevel={optLevel}
          prefetchPolicy={prefetchPolicy}
          compilers={compilers}
          selectedCompiler={selectedCompiler}
          onConfigChange={(c) => {
            configState.setConfig(c)
            configState.setPrefetchPolicy(PREFETCH_DEFAULTS[c] || 'none')
          }}
          onOptLevelChange={configState.setOptLevel}
          onPrefetchChange={(p) => configState.setPrefetchPolicy(p as PrefetchPolicy)}
          onCompilerChange={configState.setSelectedCompiler}
          onClose={() => setShowQuickConfig(false)}
        />
      )}

      {/* Topbar - hidden in embed mode */}
      {!isEmbedMode && (
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">Cache Explorer</span>
            <span className="topbar-filename">{analysisState.activeFile?.name || 'main.c'}</span>
          </div>

          <div className="topbar-right">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            />
            <button
              className="config-badge"
              onClick={() => setShowQuickConfig(true)}
              title="Change configuration"
            >
              <span>{configNames[config] || config}</span>
              <span className="config-badge-divider" />
              <span>{optLevel}</span>
            </button>

            <button
              onClick={runAnalysis}
              disabled={isLoading}
              className={`btn-run-cinema ${isLoading ? 'loading' : ''}`}
            >
              {isLoading ? (
                <>
                  <span className="run-spinner" />
                  {stageText[stage]}
                </>
              ) : (
                <>Run</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Copied Toast */}
      {copied && (
        <div className="toast">Link copied!</div>
      )}

      {/* Advanced Options Modal - using extracted component, hidden in embed mode */}
      {!isEmbedMode && (
        <AdvancedOptionsModal
          isOpen={showOptions}
          defines={defines}
          customConfig={customConfig}
          currentConfig={config}
          onDefinesChange={configState.setDefines}
          onCustomConfigChange={configState.setCustomConfig}
          onClose={() => setShowOptions(false)}
        />
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

      <div className="main">
        <div className={`editor-pane${isMobile && mobilePane !== 'editor' ? ' mobile-hidden' : ''}`}>
          {/* FileManager hidden in embed mode */}
          {!isEmbedMode && (
            <FileManager
              files={projectFiles}
              activeFileId={analysisState.activeFileId}
              onFileSelect={analysisState.setActiveFileId}
              onFileCreate={analysisState.createFile}
              onFileDelete={analysisState.closeFile}
              onFileRename={analysisState.renameFile}
              onSetMainFile={analysisState.setMainFileId}
            />
          )}
          {diffMode && baselineCode ? (
            <DiffEditor
              height={isEmbedMode ? "100%" : "calc(100% - 180px)"}
              language={monacoLanguage}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              original={baselineCode}
              modified={code}
              onMount={(editor) => {
                const modifiedEditor = editor.getModifiedEditor()
                modifiedEditor.onDidChangeModelContent(() => analysisState.updateActiveCode(modifiedEditor.getValue()))
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, renderSideBySide: true, readOnly: isReadOnly }}
            />
          ) : (
            <Editor
              height={isEmbedMode ? "100%" : (vimMode ? "calc(100% - 204px)" : "calc(100% - 180px)")}
              language={monacoLanguage}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={code}
              onChange={(value) => !isReadOnly && analysisState.updateActiveCode(value || '')}
              onMount={editorState.handleEditorMount}
              options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true, readOnly: isReadOnly }}
            />
          )}
          {vimMode && !isEmbedMode && <div ref={editorState.vimStatusRef} className="vim-status-bar" />}
        </div>

        <div className={`results-pane${isMobile && mobilePane !== 'results' ? ' mobile-hidden' : ''}`}>
          <div className="results-scroll">
            {error && <ErrorDisplay error={error} />}

            {result && (
              <>
                {/* Status Banner */}
                <div className="status-banner success">
                  <div className="status-title">Analysis Complete</div>
                  <div className="status-meta">
                    {result.events.toLocaleString()} events | {result.config} config
                    {sampleRate > 1 && ` | ${sampleRate}x sampling`}
                  </div>
                </div>

                {/* Cache Hierarchy Diagram */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Cache Hierarchy</span>
                  </div>
                  <CacheHierarchyDisplay result={result} />
                </div>

                {/* Cache Stats Grid */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Statistics</span>
                  </div>
                  <div className="panel-body">
                    <CacheStatsDisplay result={result} />
                  </div>
                </div>

                {/* Prefetch Stats */}
                {result.prefetch && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">Prefetching: {result.prefetch.policy}</span>
                    </div>
                    <div className="panel-body">
                      <div className="prefetch-stats">
                        <div className="prefetch-stat">
                          <span className="prefetch-stat-value">{result.prefetch.issued.toLocaleString()}</span>
                          <span className="prefetch-stat-label">Issued</span>
                        </div>
                        <div className="prefetch-stat">
                          <span className="prefetch-stat-value">{result.prefetch.useful.toLocaleString()}</span>
                          <span className="prefetch-stat-label">Useful</span>
                        </div>
                        <div className="prefetch-stat">
                          <span className={`prefetch-stat-value ${result.prefetch.accuracy > 0.5 ? 'excellent' : result.prefetch.accuracy > 0.2 ? 'good' : 'poor'}`}>
                            {(result.prefetch.accuracy * 100).toFixed(1)}%
                          </span>
                          <span className="prefetch-stat-label">Accuracy</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Toggle Buttons */}
                <div className="toggle-buttons">
                  <button className={`btn-toggle ${showDetails ? 'active' : ''}`} onClick={() => setShowDetails(!showDetails)}>
                    {showDetails ? '▼ Details' : '▶ Details'}
                  </button>
                  <button className={`btn-toggle ${showTimeline ? 'active' : ''}`} onClick={() => setShowTimeline(!showTimeline)}>
                    {showTimeline ? '▼ Timeline' : '▶ Timeline'}
                  </button>
                </div>

              {showTimeline && timeline.length > 0 && (
                <AccessTimelineDisplay
                  events={timeline}
                  onEventClick={(line) => {
                    if (editorState.editorRef.current) {
                      editorState.editorRef.current.revealLineInCenter(line)
                      editorState.editorRef.current.setPosition({ lineNumber: line, column: 1 })
                      editorState.editorRef.current.focus()
                    }
                  }}
                />
              )}

              {showDetails && (
                <>
                  <div className="details-grid">
                    <LevelDetail name="L1 Data" stats={result.levels.l1d || result.levels.l1!} />
                    {result.levels.l1i && <LevelDetail name="L1 Instruction" stats={result.levels.l1i} />}
                    <LevelDetail name="L2" stats={result.levels.l2} />
                    <LevelDetail name="L3" stats={result.levels.l3} />
                  </div>
                  {result.tlb && (
                    <div className="details-grid tlb-grid">
                      <TLBDetail name="Data TLB" stats={result.tlb.dtlb} />
                      <TLBDetail name="Instruction TLB" stats={result.tlb.itlb} />
                    </div>
                  )}
                  <CacheHierarchyVisualization
                    result={result}
                    timeline={timeline}
                    scrubberIndex={scrubberIndex}
                    onScrubberChange={setScrubberIndex}
                  />
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
                <FalseSharingDisplay
                  falseSharing={result.falseSharing}
                  lineSize={result.cacheConfig?.l1d?.lineSize || 64}
                />
              )}

              {result.hotLines.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Hot Lines</span>
                    <span className="panel-badge">{result.hotLines.length}</span>
                  </div>
                  <div className="hotspots">
                    {result.hotLines.slice(0, 10).map((hotLine, i) => {
                      const maxMisses = Math.max(...result.hotLines.slice(0, 10).map(h => h.misses))
                      const barWidth = maxMisses > 0 ? (hotLine.misses / maxMisses) * 100 : 0
                      return (
                        <div
                          key={i}
                          className="hotspot"
                          onClick={() => {
                            if (editorState.editorRef.current && hotLine.line > 0) {
                              editorState.editorRef.current.revealLineInCenter(hotLine.line)
                              editorState.editorRef.current.setPosition({ lineNumber: hotLine.line, column: 1 })
                              editorState.editorRef.current.focus()
                            }
                          }}
                        >
                          <div className="hotspot-header">
                            <span className="hotspot-location">Line {hotLine.line}</span>
                            <span className="hotspot-stats">
                              {hotLine.misses.toLocaleString()} misses ({formatPercent(hotLine.missRate)})
                            </span>
                          </div>
                          <div className="hotspot-bar">
                            <div
                              className="hotspot-bar-fill"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

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
                          {s.location && <span className="suggestion-location">{s.location}</span>}
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

              {/* Memory Layout Visualization */}
              {timeline.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Memory Access Pattern</span>
                    <span className="panel-badge">{timeline.length} accesses</span>
                  </div>
                  <MemoryLayout
                    recentAccesses={timeline.slice(-200).map(e => ({
                      address: e.a || 0,
                      size: 8,
                      isWrite: e.t === 'W',
                      file: e.f,
                      line: e.n,
                      hitLevel: e.l
                    }))}
                    maxAccesses={200}
                  />
                </div>
              )}
            </>
          )}

          {isLoading && (
            <div className="loading">
              <div className="spinner" />
              <span>{stageText[stage]}</span>
              {longRunning && (
                <div className="long-running-warning">
                  Taking longer than expected. Try enabling sampling in Options.
                </div>
              )}
            </div>
          )}

          {!result && !error && !isLoading && (
            <div className="placeholder">
              <div className="placeholder-icon">&gt;_</div>
              <div className="placeholder-title">Cache Explorer</div>
              <div className="placeholder-text">
                Write or paste code, then press <kbd>⌘</kbd>+<kbd>↵</kbd> to analyze cache behavior
              </div>
              <div className="placeholder-tips">
                <div className="tip">Try pressing ⌘K for examples and settings</div>
                <div className="tip">Change hardware preset to simulate different CPUs</div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Bottom Control Strip - appears after run, hidden in embed mode */}
      {result && timeline.length > 0 && !isEmbedMode && (
        <div className="bottom-strip">
          <div className="bottom-strip-left">
            <span className="strip-stat">{result.events.toLocaleString()} events</span>
            <span className="strip-divider" />
            <span className="strip-stat">{((result.levels.l1d || result.levels.l1!).hitRate * 100).toFixed(1)}% L1</span>
          </div>
          <div className="bottom-strip-center">
            <input
              type="range"
              className="timeline-slider"
              min={0}
              max={timeline.length - 1}
              value={scrubberIndex}
              onChange={(e) => setScrubberIndex(Number(e.target.value))}
              title="Scrub through cache events"
            />
            <span className="timeline-position">{scrubberIndex + 1} / {timeline.length}</span>
          </div>
          <div className="bottom-strip-right">
            <button className="strip-btn" onClick={openInCompilerExplorer} title="View in Compiler Explorer">CE ↗</button>
            <button className="strip-btn" onClick={handleShare} title="Share">Share</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
