/*
 * Validation Test: Strided Access (Cache Line Stride)
 *
 * Expected behavior:
 * - Access every 16th integer (64-byte stride = 1 cache line)
 * - Every access is to a different cache line
 * - Hit rate should be ~0% (all compulsory misses)
 *
 * 64 accesses, 64 misses, 0 hits
 * Expected L1 hit rate: 0%
 */

#include <stdio.h>

#define SIZE 1024
#define STRIDE 16  // 16 * 4 bytes = 64 bytes = cache line size

int main() {
    int arr[SIZE];

    // Strided access - always miss (one access per cache line)
    for (int i = 0; i < SIZE; i += STRIDE) {
        arr[i] = i;
    }

    // Prevent optimization
    volatile int sum = 0;
    for (int i = 0; i < SIZE; i += STRIDE) {
        sum += arr[i];
    }

    return 0;
}

/*
 * VALIDATION:
 * Run: cache-explore strided_access.c --json | jq '.levels.l1d.hitRate'
 * Expected: ~0.0 (0%)
 * Tolerance: Should be exactly 0% for first pass
 */
