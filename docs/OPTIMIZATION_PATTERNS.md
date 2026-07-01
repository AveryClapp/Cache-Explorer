# Cache Optimization Patterns

A practical guide to common cache optimization techniques with before/after examples you can test in Cache Explorer.

## 1. Loop Order (Row vs Column Major)

Arrays in C/C++ are stored in row-major order. Accessing elements in order maximizes spatial locality.

### Before (Column-Major - Bad)
```c
#define N 256
int matrix[N][N];

void bad_init() {
    for (int j = 0; j < N; j++)       // Inner loop varies slowly
        for (int i = 0; i < N; i++)   // Outer loop varies fast
            matrix[i][j] = i + j;     // Jumps by N*sizeof(int) each iteration
}
// L1 hit rate: ~87% (educational config)
```

### After (Row-Major - Good)
```c
void good_init() {
    for (int i = 0; i < N; i++)       // Outer loop varies slowly
        for (int j = 0; j < N; j++)   // Inner loop varies fast
            matrix[i][j] = i + j;     // Sequential memory access
}
// L1 hit rate: ~99%
```

**Why it works**: Sequential access loads entire cache lines and uses all bytes before eviction.

## 2. Loop Tiling (Blocking)

When data doesn't fit in cache, process it in cache-sized blocks.

### Before (Naive Matrix Multiply)
```c
#define N 128
double A[N][N], B[N][N], C[N][N];

void naive_multiply() {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            for (int k = 0; k < N; k++)
                C[i][j] += A[i][k] * B[k][j];  // B accessed column-wise
}
// L1 hit rate: ~75%
```

### After (Tiled Matrix Multiply)
```c
#define BLOCK 32  // Fits in L1 cache

void tiled_multiply() {
    for (int ii = 0; ii < N; ii += BLOCK)
        for (int jj = 0; jj < N; jj += BLOCK)
            for (int kk = 0; kk < N; kk += BLOCK)
                // Process BLOCK x BLOCK tile
                for (int i = ii; i < ii + BLOCK; i++)
                    for (int j = jj; j < jj + BLOCK; j++)
                        for (int k = kk; k < kk + BLOCK; k++)
                            C[i][j] += A[i][k] * B[k][j];
}
// L1 hit rate: ~95%
```

**Why it works**: Each tile fits in L1, so data is reused before eviction.

## 3. Structure of Arrays (SoA) vs Array of Structures (AoS)

When iterating over one field, SoA provides better cache utilization.

### Before (Array of Structures)
```c
struct Particle {
    float x, y, z;      // Position (12 bytes)
    float vx, vy, vz;   // Velocity (12 bytes)
    float mass;         // Mass (4 bytes)
    int id;             // ID (4 bytes)
};  // 32 bytes total

struct Particle particles[1000];

void update_positions_aos() {
    for (int i = 0; i < 1000; i++) {
        particles[i].x += particles[i].vx;  // Loads 32 bytes, uses 8
        particles[i].y += particles[i].vy;
        particles[i].z += particles[i].vz;
    }
}
// L1 hit rate: ~85%
```

### After (Structure of Arrays)
```c
struct Particles {
    float x[1000], y[1000], z[1000];
    float vx[1000], vy[1000], vz[1000];
    float mass[1000];
    int id[1000];
};

struct Particles p;

void update_positions_soa() {
    for (int i = 0; i < 1000; i++) {
        p.x[i] += p.vx[i];  // Sequential access, full cache line usage
        p.y[i] += p.vy[i];
        p.z[i] += p.vz[i];
    }
}
// L1 hit rate: ~99%
```

**Why it works**: Sequential access to each array maximizes cache line utilization.

## 4. Avoiding False Sharing

When threads access different data on the same cache line, they cause invalidations.

### Before (False Sharing)
```c
#include <pthread.h>

int counters[8];  // Adjacent = same cache line

void* thread_func(void* arg) {
    int id = *(int*)arg;
    for (int i = 0; i < 100000; i++)
        counters[id]++;  // Different threads, same cache line
    return NULL;
}
// Coherence invalidations: 50,000+
```

### After (Padded to Separate Cache Lines)
```c
struct PaddedCounter {
    int value;
    char padding[60];  // Ensure 64-byte alignment
};

struct PaddedCounter counters[8];

void* thread_func(void* arg) {
    int id = *(int*)arg;
    for (int i = 0; i < 100000; i++)
        counters[id].value++;  // Each counter on own cache line
    return NULL;
}
// Coherence invalidations: ~0
```

**Why it works**: Each thread's data is on a separate cache line, no sharing.

## 5. Prefetch-Friendly Access

Modern CPUs prefetch sequential data. Help the prefetcher by being predictable.

### Before (Random Access)
```c
int indices[1000];  // Random order
int data[1000];

int sum_random() {
    int sum = 0;
    for (int i = 0; i < 1000; i++)
        sum += data[indices[i]];  // Unpredictable, defeats prefetcher
    return sum;
}
// L1 hit rate: ~50%
```

### After (Sequential Access)
```c
int sum_sequential() {
    int sum = 0;
    for (int i = 0; i < 1000; i++)
        sum += data[i];  // Sequential, prefetcher helps
    return sum;
}
// L1 hit rate: ~99%
```

**Why it works**: Prefetcher detects sequential/strided patterns and loads data ahead.

## 6. Avoiding Pointer Chasing

Linked structures cause cache misses because next address isn't known until current node is loaded.

### Before (Linked List)
```c
struct Node {
    int value;
    struct Node* next;
};

int sum_list(struct Node* head) {
    int sum = 0;
    while (head) {
        sum += head->value;
        head = head->next;  // Must load node to know next address
    }
    return sum;
}
// L1 hit rate: ~30% (nodes scattered in memory)
```

### After (Array-Based)
```c
int values[1000];
int count = 1000;

int sum_array() {
    int sum = 0;
    for (int i = 0; i < count; i++)
        sum += values[i];  // Sequential, prefetchable
    return sum;
}
// L1 hit rate: ~99%
```

**Alternative**: If you need linked structure, use arena allocation to keep nodes contiguous.

## 7. Hot/Cold Splitting

Separate frequently-accessed fields from rarely-accessed ones.

### Before (All Fields Together)
```c
struct Record {
    int id;                 // Accessed every iteration
    int status;             // Accessed every iteration
    char name[64];          // Rarely accessed
    char description[256];  // Rarely accessed
};  // 328 bytes

struct Record records[1000];

void update_status() {
    for (int i = 0; i < 1000; i++)
        records[i].status++;  // Loads 328 bytes, uses 4
}
// L1 hit rate: ~60%
```

### After (Hot/Cold Split)
```c
struct RecordHot {
    int id;
    int status;
};  // 8 bytes

struct RecordCold {
    char name[64];
    char description[256];
};

struct RecordHot hot[1000];
struct RecordCold cold[1000];

void update_status() {
    for (int i = 0; i < 1000; i++)
        hot[i].status++;  // Loads 8 bytes, uses 4
}
// L1 hit rate: ~99%
```

**Why it works**: Hot data is dense, more records fit in cache.

## 8. Cache-Oblivious Algorithms

Algorithms that perform well regardless of cache size.

### Example: Cache-Oblivious Matrix Transpose
```c
void transpose_recursive(int* A, int* B, int n, int N,
                         int ar, int ac, int br, int bc) {
    if (n <= 32) {  // Base case: fits in cache
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                B[(bc + j) * N + (br + i)] = A[(ar + i) * N + (ac + j)];
    } else {
        int half = n / 2;
        // Divide into quadrants
        transpose_recursive(A, B, half, N, ar, ac, br, bc);
        transpose_recursive(A, B, half, N, ar, ac + half, br + half, bc);
        transpose_recursive(A, B, half, N, ar + half, ac, br, bc + half);
        transpose_recursive(A, B, half, N, ar + half, ac + half, br + half, bc + half);
    }
}
```

**Why it works**: Recursion naturally creates cache-sized working sets at some level.

## Testing Tips

1. **Use educational config first** - Smaller cache makes problems obvious

2. **Compare configs** - `cache-explore compare file.c --configs educational,intel`

3. **Check different sizes** - Cache behavior changes with data size

4. **Profile both versions** - Always verify optimization helps

5. **Look at L2/L3 too** - Sometimes L1 misses but L2 saves you

## Quick Reference

| Pattern | L1 Miss Symptom | Fix |
|---------|-----------------|-----|
| Column-major | High miss rate on array | Swap loop order |
| Large working set | Constant evictions | Loop tiling |
| AoS with partial use | 75-85% hit rate | Convert to SoA |
| False sharing | High invalidations | Add padding |
| Random access | ~50% hit rate | Sort or restructure |
| Pointer chasing | ~30% hit rate | Use arrays |
| Cold data in hot path | Wasted cache space | Hot/cold split |

## See Also

- [How to Read Results](HOW_TO_READ_RESULTS.md)
- [Quick Start Guide](QUICK_START.md)
