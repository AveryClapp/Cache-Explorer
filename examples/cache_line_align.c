// Cache Line Alignment - Avoiding Split Accesses
// Data aligned to cache line boundaries performs better
#include <stdio.h>
#include <stdint.h>

#define CACHE_LINE 64
#define N 1000

// Unaligned - may span two cache lines
struct Unaligned {
    char pad;           // 1 byte offset
    int64_t value;      // May cross cache line boundary
};

// Aligned - always within single cache line
struct Aligned {
    int64_t value;
    char padding[56];   // Pad to 64 bytes
} __attribute__((aligned(64)));

struct Unaligned unaligned_data[N];
struct Aligned aligned_data[N];

int main() {
    // Initialize
    for (int i = 0; i < N; i++) {
        unaligned_data[i].value = i;
        aligned_data[i].value = i;
    }

    // Access aligned data - clean cache behavior
    int64_t sum = 0;
    for (int rep = 0; rep < 10000; rep++) {
        for (int i = 0; i < N; i++) {
            sum += aligned_data[i].value;
        }
    }

    printf("Sum: %lld\n", (long long)sum);
    return 0;
}
