// Column-major matrix traversal - poor cache behavior
// Expected: Low hit rate due to strided access pattern

#include <stdio.h>

#define N 64

int main() {
  int matrix[N][N];
  int sum = 0;

  // Column-major: strided in memory (jumps N ints per access)
  for (int j = 0; j < N; j++) {
    for (int i = 0; i < N; i++) {
      matrix[i][j] = i + j;
    }
  }

  for (int j = 0; j < N; j++) {
    for (int i = 0; i < N; i++) {
      sum += matrix[i][j];
    }
  }

  printf("Sum: %d\n", sum);
  return 0;
}
