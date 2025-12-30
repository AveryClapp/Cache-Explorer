// Linked List Traversal Benchmark
// Expected: ~50-70% L1 hit rate (pointer chasing, non-contiguous)
// Validates: Non-contiguous memory access, pointer chasing

#include <stdio.h>
#include <stdlib.h>

#define N 10000
#define REPS 100

struct Node {
    int value;
    struct Node* next;
    int padding[14];  // Pad to 64 bytes (1 cache line)
};

struct Node nodes[N];

int main() {
    // Create linked list with sequential layout (best case for linked list)
    for (int i = 0; i < N - 1; i++) {
        nodes[i].value = i;
        nodes[i].next = &nodes[i + 1];
    }
    nodes[N - 1].value = N - 1;
    nodes[N - 1].next = NULL;

    // Traverse linked list
    volatile int sum = 0;
    for (int rep = 0; rep < REPS; rep++) {
        struct Node* current = &nodes[0];
        while (current != NULL) {
            sum += current->value;
            current = current->next;
        }
    }

    printf("sum=%d\n", sum);
    return 0;
}
