// Loop Fusion - Combining Loops for Better Cache Usage
// Single pass over data instead of multiple passes
#include <stdio.h>

#ifndef N
#define N 100000
#endif

float a[N], b[N], c[N], d[N];

// BAD: Separate loops - array a gets evicted before second use
void separate_loops() {
    for (int i = 0; i < N; i++) {
        b[i] = a[i] * 2;
    }
    for (int i = 0; i < N; i++) {
        c[i] = a[i] + 1;  // a[i] may be evicted, cache miss
    }
    for (int i = 0; i < N; i++) {
        d[i] = a[i] - 1;  // a[i] evicted again
    }
}

// GOOD: Fused loop - access a[i] once, use three times
void fused_loop() {
    for (int i = 0; i < N; i++) {
        float val = a[i];  // Load once
        b[i] = val * 2;
        c[i] = val + 1;
        d[i] = val - 1;
    }
}

int main() {
    // Initialize
    for (int i = 0; i < N; i++) {
        a[i] = (float)i;
    }

    // Try switching between these
    fused_loop();
    // separate_loops();

    // Verify
    float sum = 0;
    for (int i = 0; i < N; i++)
        sum += b[i] + c[i] + d[i];

    printf("Sum: %f\n", sum);
    return 0;
}
