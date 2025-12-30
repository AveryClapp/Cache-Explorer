// Prefetch-Friendly Access Pattern
// Sequential access allows hardware prefetcher to work effectively
#include <stdio.h>

#define N 1000000

int data[N];

int main() {
    // Initialize
    for (int i = 0; i < N; i++) {
        data[i] = i;
    }

    // Sequential forward scan - prefetcher excels here
    long long sum = 0;
    for (int rep = 0; rep < 5; rep++) {
        for (int i = 0; i < N; i++) {
            sum += data[i];  // Predictable stride of 4 bytes
        }
    }

    printf("Sum: %lld\n", sum);
    return 0;
}
