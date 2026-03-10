#include <stdio.h>
#include <math.h>
#include "matrix.h"

#define N 8

static int test_multiply_correctness(void) {
    double A[N*N], B[N*N], C1[N*N], C2[N*N];
    for (int i = 0; i < N*N; i++) { A[i] = i; B[i] = N*N - i; }

    matrix_multiply(C1, A, B, N);
    matrix_multiply_transposed(C2, A, B, N);

    for (int i = 0; i < N*N; i++) {
        if (fabs(C1[i] - C2[i]) > 1e-9) {
            printf("FAIL: C1[%d]=%.6f != C2[%d]=%.6f\n", i, C1[i], i, C2[i]);
            return 1;
        }
    }
    printf("PASS: multiply and multiply_transposed agree\n");
    return 0;
}

static int test_matrix_sum(void) {
    double A[4] = {1.0, 2.0, 3.0, 4.0};
    double s = matrix_sum(A, 2);
    if (fabs(s - 10.0) > 1e-9) {
        printf("FAIL: sum=%.6f expected 10.0\n", s);
        return 1;
    }
    printf("PASS: matrix_sum correct\n");
    return 0;
}

int main(void) {
    int failures = 0;
    failures += test_multiply_correctness();
    failures += test_matrix_sum();
    return failures;
}
