import type { Language } from '../types'

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
  files?: ExampleFile[]
}

export const EXAMPLES: Record<string, Example> = {
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

  false_sharing_cpp: {
    name: 'False Sharing (C++)',
    description: 'Multi-threaded cache contention with atomics',
    language: 'cpp',
    code: `// False sharing demonstration (C++ version)
// Expected: Cache invalidations when threads modify adjacent data
#include <iostream>
#include <thread>
#include <atomic>
#include <vector>

constexpr size_t CACHE_LINE_SIZE = 64;
constexpr size_t NUM_THREADS = 4;
constexpr size_t ITERATIONS = 100000;

// BAD: counters packed together, will cause false sharing
struct PackedCounters {
    std::atomic<int> counters[NUM_THREADS];
};

// GOOD: counters padded to separate cache lines
struct alignas(CACHE_LINE_SIZE) PaddedCounter {
    std::atomic<int> value{0};
    char padding[CACHE_LINE_SIZE - sizeof(std::atomic<int>)];
};

struct PaddedCounters {
    PaddedCounter counters[NUM_THREADS];
};

PackedCounters packed{};
PaddedCounters padded{};

void increment_packed(size_t id) {
    for (size_t i = 0; i < ITERATIONS; ++i)
        packed.counters[id].fetch_add(1, std::memory_order_relaxed);
}

void increment_padded(size_t id) {
    for (size_t i = 0; i < ITERATIONS; ++i)
        padded.counters[id].value.fetch_add(1, std::memory_order_relaxed);
}

int main() {
    std::cout << "False Sharing Demo\\n";

    // Test packed (false sharing)
    std::vector<std::thread> threads;
    for (size_t i = 0; i < NUM_THREADS; ++i)
        threads.emplace_back(increment_packed, i);
    for (auto& t : threads) t.join();

    // Test padded (no false sharing)
    threads.clear();
    for (size_t i = 0; i < NUM_THREADS; ++i)
        threads.emplace_back(increment_padded, i);
    for (auto& t : threads) t.join();

    std::cout << "Done\\n";
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
        code: `#ifndef MATRIX_H
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
        code: `#include "matrix.h"
#include <stdlib.h>

Matrix* matrix_create(int rows, int cols) {
    Matrix* m = malloc(sizeof(Matrix));
    m->data = malloc(rows * cols * sizeof(int));
    m->rows = rows;
    m->cols = cols;
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
    code: `#include "vector.hpp"
#include <cstdio>

int main() {
    Vector<int> v;

    for (int i = 0; i < 1000; i++)
        v.push_back(i);

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
        code: `#include "vector.hpp"
#include <cstdio>

int main() {
    Vector<int> v;

    for (int i = 0; i < 1000; i++)
        v.push_back(i);

    long sum = 0;
    for (size_t i = 0; i < v.size(); i++)
        sum += v[i];

    int random_sum = 0;
    for (int i = 0; i < 100; i++) {
        int idx = (i * 17) % v.size();
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
        code: `#ifndef VECTOR_HPP
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
        size_t new_cap = capacity_ == 0 ? 8 : capacity_ * 2;
        T* new_data = static_cast<T*>(malloc(new_cap * sizeof(T)));
        if (data_) {
            memcpy(new_data, data_, size_ * sizeof(T));
            free(data_);
        }
        data_ = new_data;
        capacity_ = new_cap;
    }

public:
    Vector() : data_(nullptr), size_(0), capacity_(0) {}
    ~Vector() { if (data_) free(data_); }

    void push_back(const T& val) {
        if (size_ >= capacity_) grow();
        data_[size_++] = val;
    }

    T& operator[](size_t idx) { return data_[idx]; }
    const T& operator[](size_t idx) const { return data_[idx]; }

    size_t size() const { return size_; }
    size_t capacity() const { return capacity_; }
    T* begin() { return data_; }
    T* end() { return data_ + size_; }
};

#endif
`
      }
    ]
  },
}

/** Default example code shown on first load */
export const DEFAULT_EXAMPLE = EXAMPLES.matrix_row.code
