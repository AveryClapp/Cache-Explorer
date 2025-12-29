// Array of Structs (AoS) - Mixed Locality
// Good for accessing all fields, wasteful if only accessing one field
#include <stdio.h>

#ifndef N
#define N 10000
#endif

// All fields together - if you only need 'x', you still load 'y' and 'z'
struct Particle {
    float x, y, z;      // Position (12 bytes)
    float vx, vy, vz;   // Velocity (12 bytes)
    float mass;         // Mass (4 bytes)
    int id;             // ID (4 bytes)
};  // Total: 32 bytes

struct Particle particles[N];

int main() {
    // Initialize
    for (int i = 0; i < N; i++) {
        particles[i].x = i * 0.1f;
        particles[i].y = i * 0.2f;
        particles[i].z = i * 0.3f;
        particles[i].mass = 1.0f;
        particles[i].id = i;
    }

    // Access ONLY x coordinates - wastes cache loading other fields
    float sum_x = 0;
    for (int rep = 0; rep < 100; rep++) {
        for (int i = 0; i < N; i++) {
            sum_x += particles[i].x;  // Stride of 32 bytes between x values
        }
    }

    printf("Sum of x: %f\n", sum_x);
    return 0;
}
