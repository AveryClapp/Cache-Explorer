// Test cases with KNOWN cache behavior for validation
// Each test has predictable, mathematically calculable cache behavior

#include <stdio.h>
#include <stdint.h>

// Test 1: Sequential access - should have ~1 miss per cache line
// With 64-byte lines and 4-byte ints, expect 1 miss per 16 elements
#define SEQ_SIZE 1024
void test_sequential(void) {
    int arr[SEQ_SIZE];
    int sum = 0;

    // Write: 1024 elements / 16 per line = 64 misses (cold start)
    for (int i = 0; i < SEQ_SIZE; i++) {
        arr[i] = i;
    }

    // Read: Should hit cache (data still there)
    // If cache too small, will miss again
    for (int i = 0; i < SEQ_SIZE; i++) {
        sum += arr[i];
    }

    printf("Sequential sum: %d\n", sum);
}

// Test 2: Strided access - should miss on every access
// Stride of 16 ints = 64 bytes = 1 cache line
#define STRIDE_SIZE 128
#define STRIDE 16
void test_strided(void) {
    int arr[STRIDE_SIZE * STRIDE];
    int sum = 0;

    // Init sequentially
    for (int i = 0; i < STRIDE_SIZE * STRIDE; i++) {
        arr[i] = i;
    }

    // Strided read: should miss on every access (128 misses)
    for (int i = 0; i < STRIDE_SIZE; i++) {
        sum += arr[i * STRIDE];
    }

    printf("Strided sum: %d\n", sum);
}

// Test 3: Repeat same element - should hit after first miss
#define REPEAT_COUNT 1000
void test_repeat_access(void) {
    int value = 42;
    int sum = 0;

    // Access same variable 1000 times
    // Should be 1 miss, 999 hits
    for (int i = 0; i < REPEAT_COUNT; i++) {
        sum += value;
    }

    printf("Repeat sum: %d\n", sum);
}

// Test 4: Column-major matrix (cache-unfriendly)
// With row-major storage, column access skips N elements
#define MATRIX_N 32
void test_column_major(void) {
    int matrix[MATRIX_N][MATRIX_N];
    int sum = 0;

    // Row-major init
    for (int i = 0; i < MATRIX_N; i++) {
        for (int j = 0; j < MATRIX_N; j++) {
            matrix[i][j] = i + j;
        }
    }

    // Column-major read: each access is N*4 = 128 bytes apart
    // For 32x32 matrix with 64-byte lines:
    // - Each column access skips 32*4=128 bytes = 2 cache lines
    // - Should miss frequently
    for (int j = 0; j < MATRIX_N; j++) {
        for (int i = 0; i < MATRIX_N; i++) {
            sum += matrix[i][j];
        }
    }

    printf("Column-major sum: %d\n", sum);
}

// Test 5: Row-major matrix (cache-friendly)
void test_row_major(void) {
    int matrix[MATRIX_N][MATRIX_N];
    int sum = 0;

    // Row-major init
    for (int i = 0; i < MATRIX_N; i++) {
        for (int j = 0; j < MATRIX_N; j++) {
            matrix[i][j] = i + j;
        }
    }

    // Row-major read: sequential in memory
    // 32x32 = 1024 elements, 64 misses expected (1 per cache line)
    for (int i = 0; i < MATRIX_N; i++) {
        for (int j = 0; j < MATRIX_N; j++) {
            sum += matrix[i][j];
        }
    }

    printf("Row-major sum: %d\n", sum);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        printf("Usage: %s <test_number>\n", argv[0]);
        printf("  1 = sequential\n");
        printf("  2 = strided\n");
        printf("  3 = repeat\n");
        printf("  4 = column_major\n");
        printf("  5 = row_major\n");
        return 1;
    }

    int test = argv[1][0] - '0';

    switch (test) {
        case 1: test_sequential(); break;
        case 2: test_strided(); break;
        case 3: test_repeat_access(); break;
        case 4: test_column_major(); break;
        case 5: test_row_major(); break;
        default: printf("Unknown test: %d\n", test); return 1;
    }

    return 0;
}
