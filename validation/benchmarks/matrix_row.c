// Matrix Row-Major Traversal Benchmark
// Expected: ~99% L1 hit rate (cache-friendly access pattern)
// Validates: Nested loop locality, row-major layout

#include <stdio.h>

#define N 500

int matrix[N][N];

int main() {
    // Initialize matrix (row-major order)
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            matrix[i][j] = i + j;
        }
    }

    // Sum matrix (row-major order - cache friendly)
    volatile int sum = 0;
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            sum += matrix[i][j];
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
