// Small Working Set - Fits in L1 Cache
// High hit rate due to temporal locality
#include <stdio.h>

// 16KB array - fits in 32KB L1 cache
#define SIZE (16 * 1024 / sizeof(int))

int data[SIZE];

int main() {
    // Initialize
    for (int i = 0; i < SIZE; i++) {
        data[i] = i;
    }

    // Repeatedly access same small dataset
    long long sum = 0;
    for (int rep = 0; rep < 1000; rep++) {
        for (int i = 0; i < SIZE; i++) {
            sum += data[i];  // Should hit L1 after first iteration
        }
    }

    printf("Sum: %lld\n", sum);
    return 0;
}
