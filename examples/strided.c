// Strided access - poor cache behavior
// Expected: Low hit rate due to skipping cache lines

#include <stdio.h>

#define N 1000
#define STRIDE 16  // Skip 16 ints = 64 bytes = 1 cache line

int main() {
  int arr[N * STRIDE];
  int sum = 0;

  for (int i = 0; i < N * STRIDE; i++) {
    arr[i] = i;
  }

  // Strided access - misses on every access
  for (int i = 0; i < N; i++) {
    sum += arr[i * STRIDE];
  }

  printf("Sum: %d\n", sum);
  return 0;
}
