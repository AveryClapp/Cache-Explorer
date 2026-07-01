// Atomic tracking: compiler builtins versus plain scalar loads/stores.
// Demonstrates: atomic advanced stats without relying on system-header macros.
#ifndef RUN_SCALAR
#define RUN_SCALAR 0
#endif

#ifndef ITERATIONS
#define ITERATIONS 256
#endif

static int counter;
static volatile int sink;

__attribute__((noinline)) void run_atomic(void) {
    for (int i = 0; i < ITERATIONS; i++) {
        __atomic_store_n(&counter, i, __ATOMIC_SEQ_CST);
        sink += __atomic_load_n(&counter, __ATOMIC_SEQ_CST);
    }
}

__attribute__((noinline)) void run_scalar(void) {
    for (int i = 0; i < ITERATIONS; i++) {
        counter = i;
        sink += counter;
    }
}

int main(void) {
#if RUN_SCALAR
    run_scalar();
#else
    run_atomic();
#endif

    return sink < 0;
}
