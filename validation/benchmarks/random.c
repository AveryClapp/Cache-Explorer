// Random Access Benchmark
// Expected: ~40-60% L1 hit rate (depends on working set vs cache size)
// Validates: Set associativity, LRU replacement

#include <stdio.h>
#include <stdlib.h>

#define N 100000
#define NUM_INDICES 1000
#define REPS 100

int arr[N];
int indices[NUM_INDICES];

// Simple LCG for deterministic "random" numbers
unsigned int seed = 42;
unsigned int lcg_rand() {
    seed = seed * 1103515245 + 12345;
    return (seed >> 16) & 0x7FFF;
}

int main() {
    // Generate deterministic random indices
    for (int i = 0; i < NUM_INDICES; i++) {
        indices[i] = lcg_rand() % N;
    }

    // Initialize array
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Random access pattern
    volatile int sum = 0;
    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < NUM_INDICES; i++) {
            sum += arr[indices[i]];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
