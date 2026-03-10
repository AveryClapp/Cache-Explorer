#include "matrix.h"

// Naive multiply — poor cache behavior (column access in B)
void matrix_multiply(double *C, const double *A, const double *B, int N) {
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            double sum = 0.0;
            for (int k = 0; k < N; k++)
                sum += A[i * N + k] * B[k * N + j];
            C[i * N + j] = sum;
        }
}

// Transpose B first — better cache behavior
void matrix_multiply_transposed(double *C, const double *A, const double *B, int N) {
    double BT[N * N];
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            BT[j * N + i] = B[i * N + j];

    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            double sum = 0.0;
            for (int k = 0; k < N; k++)
                sum += A[i * N + k] * BT[j * N + k];
            C[i * N + j] = sum;
        }
}

double matrix_sum(const double *A, int N) {
    double sum = 0.0;
    for (int i = 0; i < N * N; i++)
        sum += A[i];
    return sum;
}
