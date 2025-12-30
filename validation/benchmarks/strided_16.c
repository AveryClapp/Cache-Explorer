// Strided Access Benchmark (stride = 16 bytes = 4 ints)
// Expected: ~94% L1 hit rate (hits within cache line)
// Validates: Cache line size handling (64 bytes = 16 ints)

#include <stdio.h>

#define N 100000
#define STRIDE 4  // 4 ints = 16 bytes
#define REPS 10

int arr[N];

int main() {
    // Initialize array
    for (int i = 0; i < N; i++) {
        arr[i] = i;
    }

    // Strided read - 4 accesses per cache line
    volatile int sum = 0;
    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < N; i += STRIDE) {
            sum += arr[i];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
