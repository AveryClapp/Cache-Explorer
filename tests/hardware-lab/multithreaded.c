#include <pthread.h>
static volatile int value;
static void *worker(void *unused) { (void)unused; value = 2; return 0; }
int main(void) {
    pthread_t thread;
    value = 1;
    if (pthread_create(&thread, 0, worker, 0)) return 1;
    pthread_join(thread, 0);
    return value == 2 ? 0 : 1;
}
