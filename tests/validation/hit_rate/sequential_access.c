/*
 * Validation Test: Sequential Access Hit Rate
 *
 * Single pass through array - measures first-touch behavior.
 *
 * With 64-byte cache lines and 4-byte ints:
 * - 16 ints per cache line
 * - First int in each line = miss
 * - Next 15 ints = hits
 * - Expected hit rate: 15/16 = 93.75%
 *
 * NOTE: Total hit rate will be higher due to instruction cache hits.
 * We validate by checking miss count matches expected.
 */

#include <stdio.h>

#define SIZE 1024  // 1024 ints = 4KB = 64 cache lines

volatile int arr[SIZE];  // volatile prevents optimization

int main() {
    // Single pass - sequential write only
    for (int i = 0; i < SIZE; i++) {
        arr[i] = i;
    }
    return 0;
}

/*
 * VALIDATION:
 * Expected L1D misses: 64 (one per cache line for 4KB array)
 * Expected L1D accesses: 1024 (one per array element)
 * Expected L1D hit rate for DATA only: 960/1024 = 93.75%
 *
 * Run: cache-explore sequential_access.c --json
 * Check: misses should be ~64 for a 1024-element array
 */
