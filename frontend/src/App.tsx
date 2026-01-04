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
  useEditorState,
  useResultState,
  useAnalysisExecution
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
  TLBDetail,
  CacheGrid,
  HotLinesTable
} from './components'
import type { ProjectFile, CommandItem } from './components'

// Import constants and types
import { PREFETCH_DEFAULTS } from './constants/config'
import type { PrefetchPolicy, TimelineEvent } from './types'

// Import utilities
import { fuzzyMatch } from './utils/formatting'

type Language = 'c' | 'cpp' | 'rust'

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
  const resultState = useResultState()
  const [copied, setCopied] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [longRunning, setLongRunning] = useState(false)
  const [baselineCode, setBaselineCode] = useState<string | null>(null)
  const [vimMode, setVimMode] = useState(false)  // Vim keybindings toggle
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [showQuickConfig, setShowQuickConfig] = useState(false)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [selectedHotLineFile, setSelectedHotLineFile] = useState<string>('')  // File filter for hot lines
  const commandInputRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<TimelineEvent[]>([])  // Accumulator during streaming
  const optionsRef = useRef<HTMLDivElement>(null)

  // Monaco language mapping
  const monacoLanguage = language === 'cpp' ? 'cpp' : language === 'rust' ? 'rust' : 'c'

  // Editor state management (refs, Vim mode, decorations)
  const editorState = useEditorState(
    vimMode,
    resultState.error,
    resultState.result,
    resultState.timeline,
    resultState.scrubberIndex
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
    canRun: resultState.stage === 'idle'
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

  // Open current code in Compiler Explorer with selected compiler and optimization
  const openInCompilerExplorer = useCallback(() => {
    const sourceCode = code
    const lang = language

    // Map Cache Explorer compilers to Compiler Explorer IDs
    // Format: "gcc-14" -> "g1400", "clang-19" -> "clang1900", etc.
    const ceCompilerMap: Record<string, string> = {
      // GCC
      'gcc-10': 'g1000',
      'gcc-11': 'g1100',
      'gcc-12': 'g1200',
      'gcc-13': 'g1300',
      'gcc-14': 'g1400',
      // Clang
      'clang-15': 'clang1500',
      'clang-16': 'clang1600',
      'clang-17': 'clang1700',
      'clang-18': 'clang1800',
      'clang-19': 'clang1900',
      // Rust
      'rustc-1.70': 'r1700',
      'rustc-1.75': 'r1750',
      'rustc-1.80': 'r1800',
      'rustc-1.83': 'r1830',
      // Defaults by language when compiler not found
      'c': 'cclang1800',
      'cpp': 'clang1800',
      'rust': 'r1830'
    }

    // Map Cache Explorer opt levels to CE format
    const optMap: Record<string, string> = {
      '-O0': '-O0',
      '-O1': '-O1',
      '-O2': '-O2',
      '-O3': '-O3',
      '-Os': '-Os',
      '-Oz': '-Oz'
    }

    // Determine the CE compiler ID to use
    // Priority: selectedCompiler > language default
    let ceCmpilerId = ceCompilerMap[selectedCompiler]
    if (!ceCmpilerId) {
      // Fall back to language-specific default
      if (lang === 'cpp') {
        ceCmpilerId = ceCompilerMap['cpp'] || 'clang1800'
      } else if (lang === 'rust') {
        ceCmpilerId = ceCompilerMap['rust'] || 'r1830'
      } else {
        ceCmpilerId = ceCompilerMap['c'] || 'cclang1800'
      }
    }

    // Get optimization flags
    const optFlags = [optMap[optLevel] || '-O2']

    // Add architecture flags for accurate assembly (unless -O0)
    // This helps Compiler Explorer show CPU-specific optimizations
    if (optLevel !== '-O0') {
      optFlags.push('-march=native')
    }

    // Build CE ClientState
    const ceState = {
      sessions: [{
        id: 1,
        language: lang === 'cpp' ? 'c++' : lang,
        source: sourceCode,
        compilers: [{
          id: ceCmpilerId,
          options: optFlags.join(' ')
        }]
      }]
    }

    // Compress using LZString base64 encoding for Compiler Explorer
    const compressed = LZString.compressToBase64(JSON.stringify(ceState))
    // Use hash-based URL format that Compiler Explorer expects
    const ceUrl = `https://godbolt.org/#z=${compressed}`
    window.open(ceUrl, '_blank', 'noopener,noreferrer')
  }, [code, language, optLevel, selectedCompiler])

  // Use analysis execution hook
  const { runAnalysis } = useAnalysisExecution({
    files: analysisState.files,
    mainFileId: analysisState.mainFileId,
    config,
    optLevel,
    prefetchPolicy,
    customConfig,
    defines,
    sampleRate,
    eventLimit,
    selectedCompiler,
    longRunning,
    onStageChange: resultState.setStage,
    onResultChange: resultState.setResult,
    onErrorChange: resultState.setError,
    onTimelineAdd: (events) => {
      timelineRef.current = [...timelineRef.current, ...events]
      resultState.setTimeline([...timelineRef.current])
    },
    onTimelineReset: () => {
      timelineRef.current = []
      resultState.setTimeline([])
    },
    onLongRunningChange: setLongRunning,
    onScrubberIndexChange: resultState.setScrubberIndex
  })


  const isLoading = resultState.stage !== 'idle'
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
                  {stageText[resultState.stage]}
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
            {resultState.error && <ErrorDisplay error={resultState.error} />}

            {resultState.result && (
              <>
                {/* Results Header with Assembly Button */}
                <div className="results-header">
                  <div className="results-header-left">
                    <div className="results-title">Cache Analysis Results</div>
                  </div>
                  <div className="results-header-right">
                    <button
                      className="btn-assembly-view"
                      onClick={openInCompilerExplorer}
                      title="View the generated assembly code with your selected compiler and optimization level"
                    >
                      View Generated Assembly
                    </button>
                  </div>
                </div>

                {/* Status Banner */}
                <div className="status-banner success">
                  <div className="status-title">Analysis Complete</div>
                  <div className="status-meta">
                    {resultState.result.events.toLocaleString()} events | {resultState.result.config} config
                    {sampleRate > 1 && ` | ${sampleRate}x sampling`}
                  </div>
                </div>

                {/* Cache Hierarchy Diagram */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Cache Hierarchy</span>
                  </div>
                  <CacheHierarchyDisplay result={resultState.result} />
                </div>

                {/* Cache Stats Grid */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Statistics</span>
                  </div>
                  <div className="panel-body">
                    <CacheStatsDisplay result={resultState.result} />
                  </div>
                </div>

                {/* Prefetch Stats */}
                {resultState.result.prefetch && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-title">Prefetching: {resultState.result.prefetch.policy}</span>
                    </div>
                    <div className="panel-body">
                      <div className="prefetch-stats">
                        <div className="prefetch-stat">
                          <span className="prefetch-stat-value">{resultState.result.prefetch.issued.toLocaleString()}</span>
                          <span className="prefetch-stat-label">Issued</span>
                        </div>
                        <div className="prefetch-stat">
                          <span className="prefetch-stat-value">{resultState.result.prefetch.useful.toLocaleString()}</span>
                          <span className="prefetch-stat-label">Useful</span>
                        </div>
                        <div className="prefetch-stat">
                          <span className={`prefetch-stat-value ${resultState.result.prefetch.accuracy > 0.5 ? 'excellent' : resultState.result.prefetch.accuracy > 0.2 ? 'good' : 'poor'}`}>
                            {(resultState.result.prefetch.accuracy * 100).toFixed(1)}%
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

              {showTimeline && resultState.timeline.length > 0 && (
                <AccessTimelineDisplay
                  events={resultState.timeline}
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
                    <LevelDetail name="L1 Data" stats={resultState.result.levels.l1d || resultState.result.levels.l1!} />
                    {resultState.result.levels.l1i && <LevelDetail name="L1 Instruction" stats={resultState.result.levels.l1i} />}
                    <LevelDetail name="L2" stats={resultState.result.levels.l2} />
                    <LevelDetail name="L3" stats={resultState.result.levels.l3} />
                  </div>
                  {resultState.result.tlb && (
                    <div className="details-grid tlb-grid">
                      <TLBDetail name="Data TLB" stats={resultState.result.tlb.dtlb} />
                      <TLBDetail name="Instruction TLB" stats={resultState.result.tlb.itlb} />
                    </div>
                  )}
                  <CacheHierarchyVisualization
                    result={resultState.result}
                    timeline={resultState.timeline}
                    scrubberIndex={resultState.scrubberIndex}
                    onScrubberChange={resultState.setScrubberIndex}
                  />
                </>
              )}

              {resultState.result.coherence && resultState.result.coherence.falseSharingEvents > 0 && (
                <div className="panel warning">
                  <div className="panel-header">
                    <span className="panel-title">False Sharing Detected</span>
                    <span className="panel-badge">{resultState.result.coherence.falseSharingEvents}</span>
                  </div>
                </div>
              )}

              {resultState.result.falseSharing && resultState.result.falseSharing.length > 0 && (
                <FalseSharingDisplay
                  falseSharing={resultState.result.falseSharing}
                  lineSize={resultState.result.cacheConfig?.l1d?.lineSize || 64}
                />
              )}

              {resultState.result && resultState.result.hotLines.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Hot Lines</span>
                    <span className="panel-badge">{resultState.result.hotLines.length}</span>
                  </div>
                  <div className="panel-body">
                    {/* File Filter - only show if there are multiple files */}
                    {useMemo(() => {
                      const uniqueFiles = new Set(resultState.result?.hotLines.map(h => h.file) || [])
                      return uniqueFiles.size > 1 ? (
                        <div className="file-filter">
                          <label htmlFor="hot-line-file-select">Filter by file:</label>
                          <select
                            id="hot-line-file-select"
                            value={selectedHotLineFile}
                            onChange={(e) => setSelectedHotLineFile(e.target.value)}
                            className="file-filter-select"
                          >
                            <option value="">All files</option>
                            {Array.from(uniqueFiles)
                              .sort()
                              .map(file => (
                                <option key={file} value={file}>
                                  {file}
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : null
                    }, [resultState.result?.hotLines, selectedHotLineFile])}

                    {/* Hot Lines Table */}
                    <HotLinesTable
                      hotLines={resultState.result.hotLines}
                      filterByFile={selectedHotLineFile}
                    />
                  </div>
                </div>
              )}

              {resultState.result.suggestions && resultState.result.suggestions.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Optimization Suggestions</span>
                    <span className="panel-badge">{resultState.result.suggestions.length}</span>
                  </div>
                  <div className="suggestions">
                    {resultState.result.suggestions.map((s, i) => (
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

              {resultState.result.cacheState?.l1d && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">L1 Cache Grid</span>
                    <span className="panel-badge">Final State</span>
                  </div>
                  <CacheGrid
                    cacheState={resultState.result.cacheState.l1d}
                  />
                </div>
              )}

              {/* Memory Layout Visualization */}
              {resultState.timeline.length > 0 && (
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Memory Access Pattern</span>
                    <span className="panel-badge">{resultState.timeline.length} accesses</span>
                  </div>
                  <MemoryLayout
                    recentAccesses={resultState.timeline.slice(-200).map(e => ({
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
              <span>{stageText[resultState.stage]}</span>
              {longRunning && (
                <div className="long-running-warning">
                  Taking longer than expected. Try enabling sampling in Options.
                </div>
              )}
            </div>
          )}

          {!resultState.result && !resultState.error && !isLoading && (
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
      {resultState.result && resultState.timeline.length > 0 && !isEmbedMode && (
        <div className="bottom-strip">
          <div className="bottom-strip-left">
            <span className="strip-stat">{resultState.result.events.toLocaleString()} events</span>
            <span className="strip-divider" />
            <span className="strip-stat">{((resultState.result.levels.l1d || resultState.result.levels.l1!).hitRate * 100).toFixed(1)}% L1</span>
          </div>
          <div className="bottom-strip-center">
            <input
              type="range"
              className="timeline-slider"
              min={0}
              max={resultState.timeline.length - 1}
              value={resultState.scrubberIndex}
              onChange={(e) => resultState.setScrubberIndex(Number(e.target.value))}
              title="Scrub through cache events"
            />
            <span className="timeline-position">{resultState.scrubberIndex + 1} / {resultState.timeline.length}</span>
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
