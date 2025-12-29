// Hash Table - Random Access Pattern
// Demonstrates poor locality of hash-based lookups
#include <stdio.h>
#include <string.h>

#define TABLE_SIZE 10007  // Prime for better distribution
#define NUM_LOOKUPS 100000

struct Entry {
    int key;
    int value;
    int occupied;
};

struct Entry table[TABLE_SIZE];

// Simple hash function
int hash(int key) {
    return ((key * 2654435761U) >> 16) % TABLE_SIZE;
}

void insert(int key, int value) {
    int idx = hash(key);
    // Linear probing
    while (table[idx].occupied && table[idx].key != key) {
        idx = (idx + 1) % TABLE_SIZE;
    }
    table[idx].key = key;
    table[idx].value = value;
    table[idx].occupied = 1;
}

int lookup(int key) {
    int idx = hash(key);
    while (table[idx].occupied) {
        if (table[idx].key == key) {
            return table[idx].value;
        }
        idx = (idx + 1) % TABLE_SIZE;
    }
    return -1;  // Not found
}

int main() {
    // Clear table
    memset(table, 0, sizeof(table));

    // Insert values
    for (int i = 0; i < 5000; i++) {
        insert(i * 7, i);  // Spread keys around
    }

    // Random lookups - poor cache locality
    int sum = 0;
    for (int i = 0; i < NUM_LOOKUPS; i++) {
        int key = (i * 13) % 5000 * 7;  // Access existing keys
        int val = lookup(key);
        if (val >= 0) sum += val;
    }

    printf("Sum: %d\n", sum);
    return 0;
}
