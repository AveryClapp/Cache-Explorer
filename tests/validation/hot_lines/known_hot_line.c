/*
 * Validation Test: Hot Line Identification
 *
 * This test has TWO loops:
 * 1. A "cold" loop that fits in cache (few misses)
 * 2. A "hot" loop with strided access (many misses)
 *
 * The hot loop (line 30) should be identified as the #1 hottest line.
 */

#include <stdio.h>

// Cold function - fits in cache, few misses
void cold_function() {
    int small[64];  // 256 bytes, fits in L1
    for (int j = 0; j < 10; j++) {
        for (int i = 0; i < 64; i++) {
            small[i] = i;  // Line 18 - should have few misses
        }
    }
}

// Hot function - strided access, many misses
void hot_function() {
    int big[10000];
    // This line should be the HOTTEST - strided access = many misses
    for (int i = 0; i < 10000; i += 16) {
        big[i] = i;  // LINE 27 - THIS SHOULD BE #1 HOT LINE
    }
}

int main() {
    cold_function();
    hot_function();
    return 0;
}

/*
 * VALIDATION:
 * Run: cache-explore known_hot_line.c --json | jq '.hotLines[0]'
 * Expected: Line 27 should be the #1 hot line
 * The file should be "known_hot_line.c"
 */
