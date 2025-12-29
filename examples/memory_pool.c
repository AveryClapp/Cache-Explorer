// Memory Pool - Cache-Friendly Allocation
// Pre-allocated contiguous memory vs scattered malloc
#include <stdio.h>
#include <stdlib.h>

#define POOL_SIZE 10000

struct Object {
    int data[4];  // 16 bytes
    struct Object* next;
};

// Pool allocator - objects are contiguous
struct Object pool[POOL_SIZE];
int pool_index = 0;

struct Object* pool_alloc() {
    if (pool_index < POOL_SIZE) {
        return &pool[pool_index++];
    }
    return NULL;
}

int main() {
    struct Object* head = NULL;

    // Allocate from pool - contiguous memory
    for (int i = 0; i < POOL_SIZE; i++) {
        struct Object* obj = pool_alloc();
        if (obj) {
            obj->data[0] = i;
            obj->next = head;
            head = obj;
        }
    }

    // Traverse - good cache behavior due to contiguous storage
    int sum = 0;
    for (int rep = 0; rep < 100; rep++) {
        struct Object* curr = head;
        while (curr) {
            sum += curr->data[0];
            curr = curr->next;
        }
    }

    printf("Sum: %d\n", sum);
    return 0;
}
