// False Sharing - Multi-threaded Cache Contention
// Two threads updating adjacent data cause cache line ping-pong
#include <stdio.h>
#include <pthread.h>

#define ITERATIONS 1000000

// BAD: Both counters on same cache line (64 bytes)
struct {
    int counter1;
    int counter2;
} shared_bad;

// GOOD: Counters on separate cache lines
struct {
    int counter1;
    char padding[60];  // Pad to 64 bytes
    int counter2;
} shared_good;

void* increment_counter1(void* arg) {
    for (int i = 0; i < ITERATIONS; i++) {
        shared_bad.counter1++;  // Causes invalidation of counter2's cache line
    }
    return NULL;
}

void* increment_counter2(void* arg) {
    for (int i = 0; i < ITERATIONS; i++) {
        shared_bad.counter2++;  // Causes invalidation of counter1's cache line
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

    printf("Counter1: %d, Counter2: %d\n",
           shared_bad.counter1, shared_bad.counter2);

    return 0;
}
