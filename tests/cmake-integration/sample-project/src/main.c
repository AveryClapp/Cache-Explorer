#include <stdio.h>
#include <stdlib.h>
#include "matrix.h"

#define N 64

int main(void) {
    double *A = malloc(N * N * sizeof(double));
    double *B = malloc(N * N * sizeof(double));
    double *C = malloc(N * N * sizeof(double));

    for (int i = 0; i < N * N; i++) {
        A[i] = (double)i / (N * N);
        B[i] = (double)(N * N - i) / (N * N);
    }

    matrix_multiply(C, A, B, N);
    printf("Sum (naive):      %.4f\n", matrix_sum(C, N));

    matrix_multiply_transposed(C, A, B, N);
    printf("Sum (transposed): %.4f\n", matrix_sum(C, N));

    free(A); free(B); free(C);
    return 0;
}
