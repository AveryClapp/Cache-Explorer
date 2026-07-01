// Vector/SIMD tracking: explicit vector loads/stores versus scalar accesses.
// Demonstrates: vector trace events emitted from GCC/Clang vector extensions.
#ifndef RUN_SCALAR
#define RUN_SCALAR 0
#endif

typedef float v4sf __attribute__((vector_size(16)));

static float a[1024] __attribute__((aligned(16)));
static float b[1024] __attribute__((aligned(16)));
static float out[1024] __attribute__((aligned(16)));
static volatile float sink;

__attribute__((noinline)) void vector_step(void) {
    for (int i = 0; i < 1024; i += 4) {
        v4sf av = *(v4sf*)&a[i];
        v4sf bv = *(v4sf*)&b[i];
        *(v4sf*)&out[i] = av + bv;
    }
}

__attribute__((noinline)) void scalar_step(void) {
    for (int i = 0; i < 1024; i++) {
        out[i] = a[i] + b[i];
    }
}

int main(void) {
    for (int i = 0; i < 1024; i++) {
        a[i] = (float)i;
        b[i] = (float)(i * 2);
    }

#if RUN_SCALAR
    scalar_step();
#else
    vector_step();
#endif

    sink = out[0] + out[1023];
    return sink < 0.0f;
}
