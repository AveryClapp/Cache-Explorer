// Simple matrix multiplication for testing
#include <stdio.h>
#include <stdlib.h>

#define N 32

int main() {
    int a[N][N], b[N][N], c[N][N];

    // Initialize matrices
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            a[i][j] = i + j;
            b[i][j] = i - j;
            c[i][j] = 0;
        }
    }

    // Matrix multiplication
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            for (int k = 0; k < N; k++) {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }

    // Prevent optimization
    printf("Result: %d\n", c[0][0]);

    return 0;
}
