// Matrix Column-Major Traversal Benchmark
// Expected: ~12% L1 hit rate (cache-unfriendly access pattern)
// Validates: Cache thrashing detection, column-major inefficiency

#include <stdio.h>

#define N 500

int matrix[N][N];

int main() {
    // Initialize matrix (column-major order - bad)
    for (int j = 0; j < N; j++) {
        for (int i = 0; i < N; i++) {
            matrix[i][j] = i + j;
        }
    }

    // Sum matrix (column-major order - cache unfriendly)
    volatile int sum = 0;
    for (int j = 0; j < N; j++) {
        for (int i = 0; i < N; i++) {
            sum += matrix[i][j];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
