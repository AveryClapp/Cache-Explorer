// Quicksort - Divide and Conquer Cache Pattern
// Good cache behavior due to working on smaller and smaller partitions
#include <stdio.h>

#define N 10000

int arr[N];

void swap(int* a, int* b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int partition(int low, int high) {
    int pivot = arr[high];
    int i = low - 1;

    for (int j = low; j < high; j++) {
        if (arr[j] <= pivot) {
            i++;
            swap(&arr[i], &arr[j]);
        }
    }
    swap(&arr[i + 1], &arr[high]);
    return i + 1;
}

void quicksort(int low, int high) {
    if (low < high) {
        int pi = partition(low, high);
        quicksort(low, pi - 1);   // Left partition - likely in cache
        quicksort(pi + 1, high);  // Right partition - likely in cache
    }
}

int main() {
    // Initialize with reverse sorted (worst case for naive quicksort)
    for (int i = 0; i < N; i++) {
        arr[i] = N - i;
    }

    quicksort(0, N - 1);

    // Verify sorted
    int sorted = 1;
    for (int i = 1; i < N; i++) {
        if (arr[i] < arr[i-1]) sorted = 0;
    }

    printf("Sorted: %s\n", sorted ? "yes" : "no");
    return 0;
}
