// Strided Access Benchmark (stride = 64 bytes = 16 ints)
// Expected: ~6% L1 hit rate (misses every access, only temporal reuse)
// Validates: Miss detection, one access per cache line

#include <stdio.h>

#define N 100000
#define STRIDE 16  // 16 ints = 64 bytes = 1 cache line
#define REPS 10

int arr[N];

int main() {
    // Initialize array
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Strided read - exactly 1 access per cache line (no spatial reuse)
    volatile int sum = 0;
    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < N; i += STRIDE) {
            sum += arr[i];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
