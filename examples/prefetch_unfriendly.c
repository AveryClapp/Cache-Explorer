// Prefetch-Unfriendly Access Pattern
// Random access defeats hardware prefetcher
#include <stdio.h>
#include <stdlib.h>

#define N 1000000

int data[N];
int indices[N];

// Simple LCG random number generator
unsigned int lcg_rand(unsigned int* state) {
    *state = *state * 1103515245 + 12345;
    return (*state >> 16) & 0x7fff;
}

int main() {
    // Create random permutation for indices
    unsigned int seed = 42;
    for (int i = 0; i < N; i++) {
        indices[i] = i;
        data[i] = i;
    }

    // Fisher-Yates shuffle
    for (int i = N - 1; i > 0; i--) {
        int j = lcg_rand(&seed) % (i + 1);
        int tmp = indices[i];
        indices[i] = indices[j];
        indices[j] = tmp;
    }

    // Random access - prefetcher cannot predict
    long long sum = 0;
    for (int rep = 0; rep < 5; rep++) {
        for (int i = 0; i < N; i++) {
            sum += data[indices[i]];  // Unpredictable access
        }
    }

    printf("Sum: %lld\n", sum);
    return 0;
}
