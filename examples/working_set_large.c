// Large Working Set - Exceeds L3 Cache
// Low hit rate due to capacity misses
#include <stdio.h>

// 64MB array - exceeds typical 8-12MB L3 cache
#define SIZE (64 * 1024 * 1024 / sizeof(int))

int data[SIZE];

int main() {
    // Initialize
    for (int i = 0; i < SIZE; i++) {
        data[i] = i;
    }

    // Access large dataset - constant capacity misses
    long long sum = 0;
    for (int rep = 0; rep < 3; rep++) {
        for (int i = 0; i < SIZE; i++) {
            sum += data[i];  // Each access likely cache miss
        }
    }

    printf("Sum: %lld\n", sum);
    return 0;
}
