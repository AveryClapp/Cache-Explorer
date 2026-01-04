/*
 * Validation Test: Obvious False Sharing
 *
 * Two threads write to DIFFERENT variables that are on the SAME cache line.
 * This is textbook false sharing.
 *
 * Expected: Cache Explorer should detect and report false sharing.
 */

#include <pthread.h>
#include <stdio.h>

// Two ints adjacent in memory = same cache line (64 bytes)
struct shared_data {
    int counter_a;  // Thread 1 writes here
    int counter_b;  // Thread 2 writes here (SAME CACHE LINE = FALSE SHARING)
} data;

void* thread1_func(void* arg) {
    for (int i = 0; i < 1000; i++) {  // Reduced for faster instrumented runs
        data.counter_a++;  // Line 18 - writes to counter_a
    }
    return NULL;
}

void* thread2_func(void* arg) {
    for (int i = 0; i < 1000; i++) {  // Reduced for faster instrumented runs
        data.counter_b++;  // Line 24 - writes to counter_b (FALSE SHARING!)
    }
    return NULL;
}

int main() {
    pthread_t t1, t2;

    pthread_create(&t1, NULL, thread1_func, NULL);
    pthread_create(&t2, NULL, thread2_func, NULL);

    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    printf("counter_a = %d, counter_b = %d\n", data.counter_a, data.counter_b);
    return 0;
}

/*
 * VALIDATION:
 * Run: cache-explore obvious_false_sharing.c --json | jq '.falseSharing'
 * Expected: Non-empty array with false sharing report
 * The cache line should contain both counter_a and counter_b accesses
 */
