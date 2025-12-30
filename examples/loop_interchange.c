// Loop Interchange - Fixing Column-Major Access
// Shows how loop order affects cache performance
#include <stdio.h>

#define N 512

int matrix[N][N];

// BAD: Column-major access (stride = N * sizeof(int))
void fill_column_major() {
    for (int j = 0; j < N; j++) {
        for (int i = 0; i < N; i++) {
            matrix[i][j] = i + j;  // Jumps N elements between accesses
        }
    }
}

// GOOD: Row-major access (stride = sizeof(int))
void fill_row_major() {
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            matrix[i][j] = i + j;  // Sequential memory access
        }
    }
}

int main() {
    // Try switching between these to see difference
    fill_row_major();
    // fill_column_major();

    // Verify
    int sum = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            sum += matrix[i][j];

    printf("Sum: %d\n", sum);
    return 0;
}
