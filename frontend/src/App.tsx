import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { initVimMode } from 'monaco-vim'
import LZString from 'lz-string'
import './App.css'

// Import visualization components
import { MemoryLayout, FileManager } from './components'
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

function CacheHierarchy({ result }: { result: CacheResult }) {
  const l1d = result.levels.l1d || result.levels.l1!
  const l1i = result.levels.l1i
  const l2 = result.levels.l2
  const l3 = result.levels.l3

  const getRateClass = (rate: number) => rate > 0.95 ? 'excellent' : rate > 0.80 ? 'good' : 'poor'

  return (
    <div className="cache-hierarchy">
      {/* L1 Row */}
      <div className="cache-level-row">
        <div className={`cache-box ${getRateClass(l1d.hitRate)}`} title={`${l1d.hits.toLocaleString()} hits, ${l1d.misses.toLocaleString()} misses`}>
          <span className="cache-box-rate">{formatPercent(l1d.hitRate)}</span>
          <span className="cache-box-label">L1 Data</span>
        </div>
        {l1i && (
          <div className={`cache-box ${getRateClass(l1i.hitRate)}`} title={`${l1i.hits.toLocaleString()} hits, ${l1i.misses.toLocaleString()} misses`}>
            <span className="cache-box-rate">{formatPercent(l1i.hitRate)}</span>
            <span className="cache-box-label">L1 Instr</span>
          </div>
        )}
      </div>

      <div className="cache-connector" />

      {/* L2 */}
      <div className={`cache-box ${getRateClass(l2.hitRate)}`} title={`${l2.hits.toLocaleString()} hits, ${l2.misses.toLocaleString()} misses`}>
        <span className="cache-box-rate">{formatPercent(l2.hitRate)}</span>
        <span className="cache-box-label">L2 Cache</span>
      </div>

      <div className="cache-connector" />

      {/* L3 */}
      <div className={`cache-box ${getRateClass(l3.hitRate)}`} title={`${l3.hits.toLocaleString()} hits, ${l3.misses.toLocaleString()} misses`}>
        <span className="cache-box-rate">{formatPercent(l3.hitRate)}</span>
        <span className="cache-box-label">L3 Cache</span>
      </div>

      <div className="cache-connector" />

      {/* Memory */}
      <div className="cache-memory">
        Memory ({(l1d.misses + (l1i?.misses || 0) - l2.hits - l3.hits).toLocaleString()} accesses)
      </div>
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
  '>': 'examples',
  ':': 'settings',
  '@': 'actions',
  '*': 'config',
}

const CATEGORY_LABELS: Record<string, string> = {
  'examples': 'Examples',
  'settings': 'Settings',
  'actions': 'Actions',
  'config': 'Config',
}

const CATEGORY_ORDER = ['actions', 'examples', 'settings', 'config']

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
            placeholder={activePrefix ? `Search ${CATEGORY_LABELS[activeCategory!].toLowerCase()}...` : '> examples  : settings  @ actions  * config'}
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

// Quick Config Panel Component
function QuickConfigPanel({
  isOpen,
  config,
  optLevel,
  prefetchPolicy,
  compilers,
  selectedCompiler,
  onConfigChange,
  onOptLevelChange,
  onPrefetchChange,
  onCompilerChange,
  onClose
}: {
  isOpen: boolean
  config: string
  optLevel: string
  prefetchPolicy: string
  compilers: Compiler[]
  selectedCompiler: string
  onConfigChange: (c: string) => void
  onOptLevelChange: (o: string) => void
  onPrefetchChange: (p: string) => void
  onCompilerChange: (c: string) => void
  onClose: () => void
}) {
  if (!isOpen) return null

  return (
    <div className="quick-config-overlay" onClick={onClose}>
      <div className="quick-config" onClick={e => e.stopPropagation()}>
        <div className="quick-config-header">
          <span>Quick Settings</span>
          <button className="quick-config-close" onClick={onClose}>×</button>
        </div>
        <div className="quick-config-body">
          <div className="quick-config-row">
            <label>Hardware</label>
            <select value={config} onChange={e => onConfigChange(e.target.value)}>
              <optgroup label="Learning">
                <option value="educational">Educational (tiny)</option>
              </optgroup>
              <optgroup label="Intel">
                <option value="intel">Intel 12th Gen</option>
                <option value="intel14">Intel 14th Gen</option>
                <option value="xeon">Intel Xeon</option>
              </optgroup>
              <optgroup label="AMD">
                <option value="zen3">AMD Zen 3</option>
                <option value="amd">AMD Zen 4</option>
                <option value="epyc">AMD EPYC</option>
              </optgroup>
              <optgroup label="Apple">
                <option value="apple">Apple M1</option>
                <option value="m2">Apple M2</option>
                <option value="m3">Apple M3</option>
              </optgroup>
              <optgroup label="ARM">
                <option value="graviton">AWS Graviton 3</option>
                <option value="rpi4">Raspberry Pi 4</option>
              </optgroup>
            </select>
          </div>
          <div className="quick-config-row">
            <label>Optimization</label>
            <select value={optLevel} onChange={e => onOptLevelChange(e.target.value)}>
              <option value="-O0">-O0 (debug)</option>
              <option value="-O1">-O1</option>
              <option value="-O2">-O2 (recommended)</option>
              <option value="-O3">-O3 (aggressive)</option>
            </select>
          </div>
          <div className="quick-config-row">
            <label>Prefetch</label>
            <select value={prefetchPolicy} onChange={e => onPrefetchChange(e.target.value)}>
              <option value="none">None</option>
              <option value="next">Next Line</option>
              <option value="stream">Stream</option>
              <option value="stride">Stride</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>
          {compilers.length > 1 && (
            <div className="quick-config-row">
              <label>Compiler</label>
              <select value={selectedCompiler} onChange={e => onCompilerChange(e.target.value)}>
                {compilers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LevelDetail({ name, stats }: { name: string; stats: CacheStats }) {
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
    </div>
  )
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

// Cache line state for visualization
interface CacheLine {
  valid: boolean
  tag: number
  dirty: boolean
  lastAccess: number  // event index when last accessed
  accessCount: number
}

// Interactive cache grid with timeline scrubber
function InteractiveCacheGrid({
  config,
  timeline,
  currentIndex,
  onIndexChange
}: {
  config: CacheLevelConfig
  timeline: TimelineEvent[]
  currentIndex: number
  onIndexChange: (idx: number) => void
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(10)  // events per second
  const playRef = useRef<number | null>(null)

  // Calculate running stats up to current index
  const runningStats = useMemo(() => {
    let hits = 0, misses = 0, reads = 0, writes = 0
    for (let i = 0; i < currentIndex; i++) {
      const e = timeline[i]
      if (e.l === 1) hits++
      else misses++
      if (e.t === 'R') reads++
      else if (e.t === 'W') writes++
    }
    return { hits, misses, reads, writes }
  }, [timeline, currentIndex])

  // Find next miss event
  const findNextMiss = () => {
    for (let i = currentIndex; i < timeline.length; i++) {
      if (timeline[i].l !== 1) {  // Not an L1 hit
        return i + 1  // Return 1-indexed position
      }
    }
    return timeline.length  // No more misses, go to end
  }

  // Find previous miss event
  const findPrevMiss = () => {
    for (let i = currentIndex - 2; i >= 0; i--) {
      if (timeline[i].l !== 1) {  // Not an L1 hit
        return i + 1  // Return 1-indexed position
      }
    }
    return 0  // No previous miss, go to start
  }

  // Compute cache state up to currentIndex
  const cacheState = useMemo(() => {
    const numSets = config.sets
    const assoc = config.assoc
    const lineSize = config.lineSize

    const cache: CacheLine[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, () => ({
        valid: false,
        tag: 0,
        dirty: false,
        lastAccess: -1,
        accessCount: 0
      }))
    )

    const lruOrder: number[][] = Array.from({ length: numSets }, () =>
      Array.from({ length: assoc }, (_, i) => i)
    )

    for (let i = 0; i < Math.min(currentIndex, timeline.length); i++) {
      const event = timeline[i]
      if (!event.a || event.t === 'I') continue

      const addr = event.a
      const setIndex = Math.floor(addr / lineSize) % numSets
      const tag = Math.floor(addr / lineSize / numSets)
      const isWrite = event.t === 'W'

      const set = cache[setIndex]
      const lru = lruOrder[setIndex]

      let hitWay = -1
      for (let way = 0; way < assoc; way++) {
        if (set[way].valid && set[way].tag === tag) {
          hitWay = way
          break
        }
      }

      if (hitWay >= 0) {
        // Hit - update LRU and access info
        set[hitWay].lastAccess = i
        set[hitWay].accessCount++
        if (isWrite) set[hitWay].dirty = true

        // Move to MRU position
        const idx = lru.indexOf(hitWay)
        lru.splice(idx, 1)
        lru.push(hitWay)
      } else {
        // Miss - find victim (LRU) and replace
        const victimWay = lru[0]
        set[victimWay] = {
          valid: true,
          tag,
          dirty: isWrite,
          lastAccess: i,
          accessCount: 1
        }

        // Move to MRU position
        lru.shift()
        lru.push(victimWay)
      }
    }

    return cache
  }, [config, timeline, currentIndex])

  // Playback control
  useEffect(() => {
    if (isPlaying && currentIndex < timeline.length) {
      playRef.current = window.setInterval(() => {
        onIndexChange(Math.min(currentIndex + 1, timeline.length))
      }, 1000 / playSpeed)
    }
    return () => {
      if (playRef.current) {
        clearInterval(playRef.current)
        playRef.current = null
      }
    }
  }, [isPlaying, currentIndex, timeline.length, playSpeed, onIndexChange])

  // Stop playing when reaching end
  useEffect(() => {
    if (currentIndex >= timeline.length) {
      setIsPlaying(false)
    }
  }, [currentIndex, timeline.length])

  const getHeatColor = (line: CacheLine, maxIndex: number) => {
    if (!line.valid) return 'empty'
    const recency = maxIndex > 0 ? (line.lastAccess / maxIndex) : 0
    if (recency > 0.9) return 'hot'
    if (recency > 0.5) return 'warm'
    if (recency > 0.1) return 'cool'
    return 'cold'
  }

  const currentEvent = timeline[currentIndex - 1]
  const currentSet = currentEvent?.a
    ? Math.floor(currentEvent.a / config.lineSize) % config.sets
    : -1

  return (
    <div className="interactive-cache-grid">
      <div className="cache-grid-header">
        <div className="cache-grid-title">
          L1D Cache State ({config.sets} sets × {config.assoc} ways)
        </div>
        <div className="scrubber-controls">
          <button
            className="play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={currentIndex >= timeline.length}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
            disabled={currentIndex <= 0}
            title="Previous event"
          >
            ◀
          </button>
          <button
            className="step-btn"
            onClick={() => onIndexChange(Math.min(timeline.length, currentIndex + 1))}
            disabled={currentIndex >= timeline.length}
            title="Next event"
          >
            ▶
          </button>
          <div className="step-divider" />
          <button
            className="step-btn skip-miss"
            onClick={() => onIndexChange(findPrevMiss())}
            disabled={currentIndex <= 0}
            title="Previous miss"
          >
            ⏮
          </button>
          <button
            className="step-btn skip-miss"
            onClick={() => onIndexChange(findNextMiss())}
            disabled={currentIndex >= timeline.length}
            title="Next miss"
          >
            ⏭
          </button>
          <select
            className="speed-select"
            value={playSpeed}
            onChange={(e) => setPlaySpeed(Number(e.target.value))}
            title="Playback speed"
          >
            <option value={1}>1x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
            <option value={50}>50x</option>
            <option value={100}>100x</option>
          </select>
        </div>
        <div className="running-stats">
          <span className="stat-hit" title="L1 Hits">{runningStats.hits} hits</span>
          <span className="stat-miss" title="L1 Misses">{runningStats.misses} miss</span>
          <span className="stat-ratio" title="Hit Rate">
            {currentIndex > 0 ? ((runningStats.hits / currentIndex) * 100).toFixed(1) : 0}%
          </span>
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="timeline-scrubber">
        <input
          type="range"
          min={0}
          max={timeline.length}
          value={currentIndex}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="scrubber-slider"
        />
        <div className="scrubber-info">
          <span>Event {currentIndex} / {timeline.length}</span>
        </div>
        {currentEvent && (
          <div className="current-event-details">
            <span className={`event-type ${currentEvent.t === 'R' ? 'read' : currentEvent.t === 'W' ? 'write' : 'fetch'}`}>
              {currentEvent.t === 'R' ? 'READ' : currentEvent.t === 'W' ? 'WRITE' : 'FETCH'}
            </span>
            <span className={`event-result ${currentEvent.l === 1 ? 'l1' : currentEvent.l === 2 ? 'l2' : currentEvent.l === 3 ? 'l3' : 'mem'}`}>
              {currentEvent.l === 1 ? 'L1 Hit' : currentEvent.l === 2 ? 'L2 Hit' : currentEvent.l === 3 ? 'L3 Hit' : 'Memory'}
            </span>
            {currentEvent.a && (
              <span className="event-address">0x{currentEvent.a.toString(16).padStart(8, '0')}</span>
            )}
            {currentSet >= 0 && (
              <span className="event-set">Set {currentSet}</span>
            )}
            {currentEvent.f && currentEvent.n && (
              <span className="event-source">{currentEvent.f}:{currentEvent.n}</span>
            )}
          </div>
        )}
      </div>

      {/* Cache grid */}
      <div className="cache-grid animated">
        <div className="grid-header">
          <div className="grid-corner">Set</div>
          {Array.from({ length: config.assoc }, (_, i) => (
            <div key={i} className="grid-way-label">W{i}</div>
          ))}
        </div>
        {Array.from({ length: Math.min(config.sets, 16) }, (_, setIdx) => (
          <div
            key={setIdx}
            className={`grid-row ${setIdx === currentSet ? 'active-set' : ''}`}
          >
            <div className="grid-set-label">{setIdx}</div>
            {cacheState[setIdx].map((line: CacheLine, wayIdx: number) => (
              <div
                key={wayIdx}
                className={`grid-cell ${getHeatColor(line, currentIndex)} ${line.dirty ? 'dirty' : ''}`}
                title={line.valid
                  ? `Tag: 0x${line.tag.toString(16)}\nAccesses: ${line.accessCount}\nLast: #${line.lastAccess}${line.dirty ? '\n(dirty)' : ''}`
                  : 'Empty'
                }
              >
                {line.valid && (
                  <span className="cell-tag">
                    {line.accessCount > 1 ? line.accessCount : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {config.sets > 16 && (
          <div className="grid-ellipsis">... {config.sets - 16} more sets</div>
        )}
      </div>

      <div className="cache-grid-legend">
        <span className="legend-item"><span className="legend-color empty" /> Empty</span>
        <span className="legend-item"><span className="legend-color cold" /> Cold</span>
        <span className="legend-item"><span className="legend-color cool" /> Cool</span>
        <span className="legend-item"><span className="legend-color warm" /> Warm</span>
        <span className="legend-item"><span className="legend-color hot" /> Hot</span>
        <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
      </div>
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

function CacheHierarchyViz({ result, timeline, scrubberIndex, onScrubberChange }: {
  result: CacheResult
  timeline?: TimelineEvent[]
  scrubberIndex?: number
  onScrubberChange?: (idx: number) => void
}) {
  const config = result.cacheConfig
  const levels = result.levels

  const l1d = levels.l1d || levels.l1
  const l1i = levels.l1i
  const l2 = levels.l2
  const l3 = levels.l3

  if (!l1d) return null

  const formatSize = (kb: number) => {
    if (kb >= 1024) return `${kb / 1024} MB`
    return `${kb} KB`
  }

  const getHitRateClass = (rate: number) => {
    if (rate >= 0.95) return 'excellent'
    if (rate >= 0.8) return 'good'
    if (rate >= 0.5) return 'moderate'
    return 'poor'
  }

  const HitRateBar = ({ rate, label }: { rate: number; label: string }) => (
    <div className="hit-rate-bar">
      <div className="hit-rate-label">{label}</div>
      <div className="hit-rate-track">
        <div
          className={`hit-rate-fill ${getHitRateClass(rate)}`}
          style={{ width: `${rate * 100}%` }}
        />
      </div>
      <div className="hit-rate-value">{(rate * 100).toFixed(1)}%</div>
    </div>
  )

  return (
    <div className="cache-hierarchy-viz">
      <div className="hierarchy-title">Cache Hierarchy</div>

      <div className="hierarchy-diagram">
        {/* CPU Core */}
        <div className="hierarchy-level cpu">
          <div className="level-box cpu-box">
            <div className="box-label">CPU Core</div>
          </div>
        </div>

        {/* L1 Caches */}
        <div className="hierarchy-level l1">
          <div className={`level-box l1-box ${getHitRateClass(l1d.hitRate)}`}>
            <div className="box-label">L1 Data</div>
            {config && <div className="box-size">{formatSize(config.l1d.sizeKB)}</div>}
            <div className="box-stats">
              {l1d.hits} hits / {l1d.misses} misses
            </div>
          </div>
          {l1i && (
            <div className={`level-box l1-box ${getHitRateClass(l1i.hitRate)}`}>
              <div className="box-label">L1 Instr</div>
              {config && <div className="box-size">{formatSize(config.l1i.sizeKB)}</div>}
              <div className="box-stats">
                {l1i.hits} hits / {l1i.misses} misses
              </div>
            </div>
          )}
        </div>

        <div className="hierarchy-connector" />

        {/* L2 Cache */}
        <div className="hierarchy-level l2">
          <div className={`level-box l2-box ${getHitRateClass(l2.hitRate)}`}>
            <div className="box-label">L2 Unified</div>
            {config && <div className="box-size">{formatSize(config.l2.sizeKB)}</div>}
            <div className="box-stats">
              {l2.hits} hits / {l2.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* L3 Cache */}
        <div className="hierarchy-level l3">
          <div className={`level-box l3-box ${getHitRateClass(l3.hitRate)}`}>
            <div className="box-label">L3 Shared</div>
            {config && <div className="box-size">{formatSize(config.l3.sizeKB)}</div>}
            <div className="box-stats">
              {l3.hits} hits / {l3.misses} misses
            </div>
          </div>
        </div>

        <div className="hierarchy-connector" />

        {/* Main Memory */}
        <div className="hierarchy-level memory">
          <div className="level-box memory-box">
            <div className="box-label">Main Memory</div>
            <div className="box-stats">{l3.misses} accesses</div>
          </div>
        </div>
      </div>

      {/* Hit Rate Bars */}
      <div className="hit-rates-section">
        <div className="hit-rates-title">Hit Rates</div>
        <HitRateBar rate={l1d.hitRate} label="L1 Data" />
        {l1i && <HitRateBar rate={l1i.hitRate} label="L1 Instr" />}
        <HitRateBar rate={l2.hitRate} label="L2" />
        <HitRateBar rate={l3.hitRate} label="L3" />
      </div>

      {/* Interactive Cache Grid with Timeline Scrubber */}
      {config && config.l1d.sets <= 64 && timeline && timeline.length > 0 && onScrubberChange && (
        <InteractiveCacheGrid
          config={config.l1d}
          timeline={timeline}
          currentIndex={scrubberIndex ?? timeline.length}
          onIndexChange={onScrubberChange}
        />
      )}

      {/* Static grid fallback when no timeline */}
      {config && config.l1d.sets <= 64 && (!timeline || timeline.length === 0) && (
        <div className="cache-grid-section">
          <div className="cache-grid-title">
            L1 Data Cache Structure ({config.l1d.sets} sets × {config.l1d.assoc} ways)
          </div>
          <div className="cache-grid">
            <div className="grid-header">
              <div className="grid-corner">Set</div>
              {Array.from({ length: config.l1d.assoc }, (_, i) => (
                <div key={i} className="grid-way-label">Way {i}</div>
              ))}
            </div>
            {Array.from({ length: Math.min(config.l1d.sets, 16) }, (_, setIdx) => (
              <div key={setIdx} className="grid-row">
                <div className="grid-set-label">{setIdx}</div>
                {Array.from({ length: config.l1d.assoc }, (_, wayIdx) => (
                  <div key={wayIdx} className="grid-cell" title={`Set ${setIdx}, Way ${wayIdx}`} />
                ))}
              </div>
            ))}
            {config.l1d.sets > 16 && (
              <div className="grid-ellipsis">... {config.l1d.sets - 16} more sets</div>
            )}
          </div>
          <div className="cache-grid-legend">
            <span className="legend-item"><span className="legend-color empty" /> Empty</span>
            <span className="legend-item"><span className="legend-color valid" /> Valid</span>
            <span className="legend-item"><span className="legend-color dirty" /> Dirty</span>
          </div>
        </div>
      )}
    </div>
  )
}

function AccessTimeline({ events, onEventClick }: { events: TimelineEvent[], onEventClick?: (line: number) => void }) {
  const maxEvents = 500  // Limit display for performance
  const displayEvents = events.slice(-maxEvents)

  const getLevelColor = (level: number) => {
    switch (level) {
      case 1: return 'level-l1'  // L1 hit - green
      case 2: return 'level-l2'  // L2 hit - yellow
      case 3: return 'level-l3'  // L3 hit - orange
      case 4: return 'level-mem' // Memory - red
      default: return 'level-mem'
    }
  }

  const getLevelName = (level: number) => {
    switch (level) {
      case 1: return 'L1'
      case 2: return 'L2'
      case 3: return 'L3'
      case 4: return 'Mem'
      default: return '?'
    }
  }

  const getTypeName = (type: string) => {
    switch (type) {
      case 'R': return 'Read'
      case 'W': return 'Write'
      case 'I': return 'Fetch'
      default: return type
    }
  }

  // Count events by level
  const counts = { l1: 0, l2: 0, l3: 0, mem: 0 }
  for (const e of events) {
    if (e.l === 1) counts.l1++
    else if (e.l === 2) counts.l2++
    else if (e.l === 3) counts.l3++
    else counts.mem++
  }

  return (
    <div className="access-timeline">
      <div className="timeline-header">
        <span className="timeline-title">Access Timeline</span>
        <span className="timeline-count">{events.length.toLocaleString()} events</span>
      </div>

      <div className="timeline-summary">
        <span className="timeline-stat level-l1">{counts.l1} L1</span>
        <span className="timeline-stat level-l2">{counts.l2} L2</span>
        <span className="timeline-stat level-l3">{counts.l3} L3</span>
        <span className="timeline-stat level-mem">{counts.mem} Mem</span>
      </div>

      <div className="timeline-strip">
        {displayEvents.map((e, idx) => (
          <div
            key={idx}
            className={`timeline-event ${getLevelColor(e.l)}`}
            title={`#${e.i}: ${getTypeName(e.t)} → ${getLevelName(e.l)}${e.f ? ` (${e.f}:${e.n})` : ''}`}
            onClick={() => e.n && onEventClick?.(e.n)}
          />
        ))}
      </div>

      <div className="timeline-legend">
        <span className="legend-item"><span className="legend-dot level-l1" /> L1 Hit</span>
        <span className="legend-item"><span className="legend-dot level-l2" /> L2 Hit</span>
        <span className="legend-item"><span className="legend-dot level-l3" /> L3 Hit</span>
        <span className="legend-item"><span className="legend-dot level-mem" /> Memory</span>
      </div>

      {events.length > maxEvents && (
        <div className="timeline-truncated">
          Showing last {maxEvents} of {events.length.toLocaleString()} events
        </div>
      )}
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
  const [customConfig, setCustomConfig] = useState<CustomCacheConfig>(defaultCustomConfig)
  const [defines, setDefines] = useState<DefineEntry[]>([])
  const [copied, setCopied] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [sampleRate, setSampleRate] = useState(1)  // 1 = no sampling
  const [eventLimit, setEventLimit] = useState(5000000)  // 5M default (~30s max runtime)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [scrubberIndex, setScrubberIndex] = useState<number>(0)  // For interactive cache grid
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [showQuickConfig, setShowQuickConfig] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [mobilePane, setMobilePane] = useState<'editor' | 'results'>('editor')
  const commandInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineEvent[]>([])  // Accumulator during streaming
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const decorationsRef = useRef<string[]>([])
  const stepDecorationsRef = useRef<string[]>([])  // For step-through highlighting
  const optionsRef = useRef<HTMLDivElement>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimModeRef = useRef<{ dispose: () => void } | null>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cache-explorer-theme', theme)
  }, [theme])

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
      // Escape to close modals
      if (e.key === 'Escape') {
        setShowOptions(false)
        setShowCommandPalette(false)
        setShowQuickConfig(false)
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
        setFiles([createFileTab(`main${getFileExtension(lang)}`, state.code, lang)])
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

  // Open current code in Compiler Explorer
  const openInCompilerExplorer = useCallback(() => {
    // Get active file's code
    const activeFile = files.find(f => f.id === activeFileId)
    const sourceCode = activeFile?.code || ''
    const lang = activeFile?.language || 'c'

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
  }, [files, activeFileId, optLevel])

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

  // Highlight current line when stepping through timeline
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !timeline.length) {
      if (editorRef.current && stepDecorationsRef.current.length > 0) {
        stepDecorationsRef.current = editorRef.current.deltaDecorations(stepDecorationsRef.current, [])
      }
      return
    }

    const monaco = monacoRef.current
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const currentEvent = timeline[scrubberIndex - 1]
    const decorations: editor.IModelDeltaDecoration[] = []

    if (currentEvent?.n && currentEvent.n > 0 && currentEvent.n <= model.getLineCount()) {
      const lineNum = currentEvent.n
      decorations.push({
        range: new monaco.Range(lineNum, 1, lineNum, 1),
        options: {
          isWholeLine: true,
          className: 'line-step-highlight',
          glyphMarginClassName: 'glyph-step',
        }
      })
      // Scroll the line into view
      editor.revealLineInCenterIfOutsideViewport(lineNum)
    }

    stepDecorationsRef.current = editor.deltaDecorations(stepDecorationsRef.current, decorations)
  }, [timeline, scrubberIndex])

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
        setFiles(prev => prev.map(f => f.id === activeFileId ? { ...f, code: ex.code, language: ex.language, name: 'main' + getFileExtension(ex.language) } : f))
      },
      category: 'examples'
    })),
    // Settings (:)
    { id: 'vim', icon: ':', label: vimMode ? 'Disable Vim mode' : 'Enable Vim mode', action: () => setVimMode(!vimMode), category: 'settings' },
    { id: 'lang-c', icon: ':', label: 'Language: C', action: () => updateActiveLanguage('c'), category: 'settings' },
    { id: 'lang-cpp', icon: ':', label: 'Language: C++', action: () => updateActiveLanguage('cpp'), category: 'settings' },
    { id: 'lang-rust', icon: ':', label: 'Language: Rust', action: () => updateActiveLanguage('rust'), category: 'settings' },
    // Config (*)
    { id: 'config', icon: '*', label: 'Hardware config...', action: () => setShowQuickConfig(true), category: 'config' },
    { id: 'options', icon: '*', label: 'Advanced options...', action: () => setShowOptions(true), category: 'config' },
    { id: 'sampling-none', icon: '*', label: 'Sampling: All events', action: () => setSampleRate(1), category: 'config' },
    { id: 'sampling-10', icon: '*', label: 'Sampling: 1:10', action: () => setSampleRate(10), category: 'config' },
    { id: 'sampling-100', icon: '*', label: 'Sampling: 1:100', action: () => setSampleRate(100), category: 'config' },
    { id: 'limit-1m', icon: '*', label: 'Event limit: 1M', action: () => setEventLimit(1000000), category: 'config' },
    { id: 'limit-5m', icon: '*', label: 'Event limit: 5M', action: () => setEventLimit(5000000), category: 'config' },
    { id: 'limit-none', icon: '*', label: 'Event limit: None', action: () => setEventLimit(0), category: 'config' },
  ], [isLoading, activeFileId, vimMode, diffMode, baselineCode, code, handleShare, openInCompilerExplorer, updateActiveLanguage])

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
            setConfig(c)
            setPrefetchPolicy(PREFETCH_DEFAULTS[c] || 'none')
          }}
          onOptLevelChange={setOptLevel}
          onPrefetchChange={(p) => setPrefetchPolicy(p as PrefetchPolicy)}
          onCompilerChange={setSelectedCompiler}
          onClose={() => setShowQuickConfig(false)}
        />
      )}

      {/* Topbar - hidden in embed mode */}
      {!isEmbedMode && (
        <div className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">Cache Explorer</span>
            <span className="topbar-filename">{activeFile?.name || 'main.c'}</span>
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

      {/* Advanced Options Modal - hidden in embed mode */}
      {showOptions && !isEmbedMode && (
        <div className="options-modal-overlay" onClick={() => setShowOptions(false)}>
          <div className="options-modal" onClick={e => e.stopPropagation()}>
            <div className="options-modal-header">
              <span>Advanced Options</span>
              <button className="quick-config-close" onClick={() => setShowOptions(false)}>×</button>
            </div>
            <div className="options-modal-body">
              <div className="option-section">
                <div className="option-label">Preprocessor Defines</div>
                <div className="defines-list">
                  {defines.map((def, i) => (
                    <div key={i} className="define-row">
                      <span className="define-d">-D</span>
                      <input
                        type="text"
                        placeholder="NAME"
                        value={def.name}
                        onChange={(e) => {
                          const newDefs = [...defines]
                          newDefs[i].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')
                          setDefines(newDefs)
                        }}
                        className="define-name"
                      />
                      <span className="define-eq">=</span>
                      <input
                        type="text"
                        placeholder="value"
                        value={def.value}
                        onChange={(e) => {
                          const newDefs = [...defines]
                          newDefs[i].value = e.target.value
                          setDefines(newDefs)
                        }}
                        className="define-value"
                      />
                      <button className="btn-remove" onClick={() => setDefines(defines.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <button className="btn-add" onClick={() => setDefines([...defines, { name: '', value: '' }])}>
                    + Add Define
                  </button>
                </div>
              </div>

              {config === 'custom' && (
                <div className="option-section">
                  <div className="option-label">Custom Cache Config</div>
                  <div className="config-grid">
                    <label>Line Size</label>
                    <input type="number" value={customConfig.lineSize} onChange={(e) => setCustomConfig({ ...customConfig, lineSize: parseInt(e.target.value) || 64 })} />
                    <label>L1 Size</label>
                    <input type="number" value={customConfig.l1Size} onChange={(e) => setCustomConfig({ ...customConfig, l1Size: parseInt(e.target.value) || 32768 })} />
                    <label>L1 Assoc</label>
                    <input type="number" value={customConfig.l1Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l1Assoc: parseInt(e.target.value) || 8 })} />
                    <label>L2 Size</label>
                    <input type="number" value={customConfig.l2Size} onChange={(e) => setCustomConfig({ ...customConfig, l2Size: parseInt(e.target.value) || 262144 })} />
                    <label>L2 Assoc</label>
                    <input type="number" value={customConfig.l2Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l2Assoc: parseInt(e.target.value) || 8 })} />
                    <label>L3 Size</label>
                    <input type="number" value={customConfig.l3Size} onChange={(e) => setCustomConfig({ ...customConfig, l3Size: parseInt(e.target.value) || 8388608 })} />
                    <label>L3 Assoc</label>
                    <input type="number" value={customConfig.l3Assoc} onChange={(e) => setCustomConfig({ ...customConfig, l3Assoc: parseInt(e.target.value) || 16 })} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
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
              activeFileId={activeFileId}
              onFileSelect={setActiveFileId}
              onFileCreate={createFile}
              onFileDelete={closeFile}
              onFileRename={renameFile}
              onSetMainFile={setMainFileId}
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
                modifiedEditor.onDidChangeModelContent(() => updateActiveCode(modifiedEditor.getValue()))
              }}
              options={{ minimap: { enabled: false }, fontSize: 13, renderSideBySide: true, readOnly: isReadOnly }}
            />
          ) : (
            <Editor
              height={isEmbedMode ? "100%" : (vimMode ? "calc(100% - 204px)" : "calc(100% - 180px)")}
              language={monacoLanguage}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={code}
              onChange={(value) => !isReadOnly && updateActiveCode(value || '')}
              onMount={handleEditorMount}
              options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, glyphMargin: true, readOnly: isReadOnly }}
            />
          )}
          {vimMode && !isEmbedMode && <div ref={vimStatusRef} className="vim-status-bar" />}
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
                  <CacheHierarchy result={result} />
                </div>

                {/* Cache Stats Grid */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Statistics</span>
                  </div>
                  <div className="panel-body">
                    <CacheStats result={result} />
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
                <AccessTimeline
                  events={timeline}
                  onEventClick={(line) => {
                    if (editorRef.current) {
                      editorRef.current.revealLineInCenter(line)
                      editorRef.current.setPosition({ lineNumber: line, column: 1 })
                      editorRef.current.focus()
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
                  <CacheHierarchyViz
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
                <FalseSharingViz
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
                            if (editorRef.current && hotLine.line > 0) {
                              editorRef.current.revealLineInCenter(hotLine.line)
                              editorRef.current.setPosition({ lineNumber: hotLine.line, column: 1 })
                              editorRef.current.focus()
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
