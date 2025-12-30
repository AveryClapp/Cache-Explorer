// Working Set Benchmark
// Expected: Varies based on working set size vs cache size
// Validates: Working set behavior, cache capacity effects

#include <stdio.h>

// Working set sizes to test (in KB)
// L1 is typically 32-48KB, so we test below and above
#define SMALL_WS (8 * 1024 / sizeof(int))    // 8KB - fits in L1
#define MEDIUM_WS (64 * 1024 / sizeof(int))  // 64KB - exceeds L1, fits L2
#define LARGE_WS (512 * 1024 / sizeof(int))  // 512KB - exceeds L2

#define REPS 100

int small_arr[SMALL_WS];
int medium_arr[MEDIUM_WS];
int large_arr[LARGE_WS];

int main() {
    // Initialize arrays
    for (int i = 0; i < SMALL_WS; i++) small_arr[i] = i;
    for (int i = 0; i < MEDIUM_WS; i++) medium_arr[i] = i;
    for (int i = 0; i < LARGE_WS; i++) large_arr[i] = i;

    volatile int sum = 0;

    // Small working set - should have very high hit rate
    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < SMALL_WS; i++) {
            sum += small_arr[i];
        }
    }

    // Medium working set - lower hit rate
    for (int rep = 0; rep < REPS / 10; rep++) {
        for (int i = 0; i < MEDIUM_WS; i++) {
            sum += medium_arr[i];
        }
    }

    // Large working set - even lower hit rate
    for (int rep = 0; rep < REPS / 50; rep++) {
        for (int i = 0; i < LARGE_WS; i++) {
            sum += large_arr[i];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
