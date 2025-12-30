// Cache Blocking (Tiling) - Matrix Multiply Optimization
// Compares naive vs blocked implementation
#include <stdio.h>

#define N 256
#define BLOCK 32  // Should be tuned to L1 cache size

float A[N][N], B[N][N], C[N][N];

// Naive matrix multiply - poor cache utilization
void matmul_naive() {
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            float sum = 0;
            for (int k = 0; k < N; k++) {
                sum += A[i][k] * B[k][j];  // B[k][j] has stride N
            }
            C[i][j] = sum;
        }
    }
}

// Blocked matrix multiply - better cache utilization
void matmul_blocked() {
    for (int i = 0; i < N; i += BLOCK) {
        for (int j = 0; j < N; j += BLOCK) {
            for (int k = 0; k < N; k += BLOCK) {
                // Process BLOCK x BLOCK tile
                for (int ii = i; ii < i + BLOCK && ii < N; ii++) {
                    for (int jj = j; jj < j + BLOCK && jj < N; jj++) {
                        float sum = C[ii][jj];
                        for (int kk = k; kk < k + BLOCK && kk < N; kk++) {
                            sum += A[ii][kk] * B[kk][jj];
                        }
                        C[ii][jj] = sum;
                    }
                }
            }
        }
    }
}

int main() {
    // Initialize matrices
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            A[i][j] = (float)(i + j);
            B[i][j] = (float)(i - j);
            C[i][j] = 0;
        }
    }

    // Run blocked version (change to matmul_naive() to compare)
    matmul_blocked();

    // Checksum
    float sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += C[i][j];

    printf("Checksum: %f\n", sum);
    return 0;
}
