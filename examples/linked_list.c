// Linked List Traversal - Pointer Chasing (Cache Unfriendly)
// Demonstrates poor spatial locality due to scattered memory allocation
#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node* next;
};

#define N 10000

int main() {
    // Create linked list with scattered allocations
    struct Node* head = NULL;
    for (int i = 0; i < N; i++) {
        struct Node* node = malloc(sizeof(struct Node));
        node->value = i;
        node->next = head;
        head = node;
    }

    // Traverse - each node likely cache miss
    int sum = 0;
    for (int rep = 0; rep < 10; rep++) {
        struct Node* curr = head;
        while (curr) {
            sum += curr->value;  // Random memory access pattern
            curr = curr->next;
        }
    }

    printf("Sum: %d\n", sum);

    // Cleanup
    while (head) {
        struct Node* tmp = head;
        head = head->next;
        free(tmp);
    }

    return 0;
}
