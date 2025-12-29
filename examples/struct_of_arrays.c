// Struct of Arrays (SoA) - Excellent Locality for Single Field Access
// Compare with array_of_structs.c to see the difference
#include <stdio.h>

#ifndef N
#define N 10000
#endif

// Fields separated - access only what you need
struct Particles {
    float x[N], y[N], z[N];      // Positions
    float vx[N], vy[N], vz[N];   // Velocities
    float mass[N];                // Masses
    int id[N];                    // IDs
};

struct Particles p;

int main() {
    // Initialize
    for (int i = 0; i < N; i++) {
        p.x[i] = i * 0.1f;
        p.y[i] = i * 0.2f;
        p.z[i] = i * 0.3f;
        p.mass[i] = 1.0f;
        p.id[i] = i;
    }

    // Access ONLY x coordinates - perfect sequential access
    float sum_x = 0;
    for (int rep = 0; rep < 100; rep++) {
        for (int i = 0; i < N; i++) {
            sum_x += p.x[i];  // Stride of 4 bytes - cache friendly!
        }
    }

    printf("Sum of x: %f\n", sum_x);
    return 0;
}
