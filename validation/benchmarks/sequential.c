// Sequential Access Benchmark
// Expected: ~99% L1 hit rate (excellent spatial locality)
// Validates: Spatial locality, cache line prefetching

#include <stdio.h>

#define N 100000
#define REPS 10

int arr[N];

int main() {
    // Initialize array
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Sequential read - should hit cache after initial miss per line
    volatile int sum = 0;
    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < N; i++) {
            sum += arr[i];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
