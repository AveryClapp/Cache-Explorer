// Binary Search - Unpredictable Memory Access Pattern
// Each probe is a cache miss until working set fits in cache
#include <stdio.h>

#define N 1000000

int arr[N];

int binary_search(int target) {
    int left = 0, right = N - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}

int main() {
    // Initialize sorted array
    for (int i = 0; i < N; i++) {
        arr[i] = i * 2;  // Even numbers
    }

    // Search for many values
    int found = 0;
    for (int i = 0; i < 10000; i++) {
        int target = (i * 7) % (N * 2);  // Mix of hits and misses
        if (binary_search(target) >= 0) {
            found++;
        }
    }

    printf("Found: %d\n", found);
    return 0;
}
