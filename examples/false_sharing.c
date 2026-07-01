// False Sharing - Multi-threaded Cache Contention
// Two threads updating adjacent data cause cache line ping-pong
#include <stdio.h>
#include <pthread.h>

#ifndef ITERATIONS
#define ITERATIONS 1000000
#endif

// BAD: Both counters on same cache line (64 bytes)
struct {
    volatile int counter1;
    volatile int counter2;
} shared_bad;

// GOOD: Counters on separate cache lines
struct {
    volatile int counter1;
    char padding[60];  // Pad to 64 bytes
    volatile int counter2;
} shared_good;

void* increment_counter1(void* arg) {
    for (int i = 0; i < ITERATIONS; i++) {
#ifdef RUN_PADDED
        shared_good.counter1++;
#else
        shared_bad.counter1++;  // Causes invalidation of counter2's cache line
#endif
    }
    return NULL;
}

void* increment_counter2(void* arg) {
    for (int i = 0; i < ITERATIONS; i++) {
#ifdef RUN_PADDED
        shared_good.counter2++;
#else
        shared_bad.counter2++;  // Causes invalidation of counter1's cache line
#endif
    }
    return NULL;
}

int main() {
    pthread_t t1, t2;

    // Create threads that update adjacent data
    pthread_create(&t1, NULL, increment_counter1, NULL);
    pthread_create(&t2, NULL, increment_counter2, NULL);

    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

#ifdef RUN_PADDED
    printf("Padded Counter1: %d, Counter2: %d\n",
           shared_good.counter1, shared_good.counter2);
#else
    printf("Packed Counter1: %d, Counter2: %d\n",
           shared_bad.counter1, shared_bad.counter2);
#endif

    return 0;
}
