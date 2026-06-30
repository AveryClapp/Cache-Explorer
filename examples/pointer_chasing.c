// Pointer chasing with a randomized node order.
// The loop branch is predictable, but each load depends on the previous load.
#include <stdio.h>

#define N 65536
#define STRIDE 4099
#define REPS 8

struct Node {
    int value;
    int next;
    char padding[56];
};

static struct Node nodes[N];

int main() {
    for (int i = 0; i < N; i++) {
        nodes[i].value = i;
        nodes[i].next = (i + STRIDE) & (N - 1);
    }

    long long sum = 0;
    int index = 0;

    for (int rep = 0; rep < REPS; rep++) {
        for (int i = 0; i < N; i++) {
            sum += nodes[index].value;
            index = nodes[index].next;
        }
    }

    printf("%lld %d\n", sum, index);
    return 0;
}
