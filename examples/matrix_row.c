// Row-major matrix traversal - good cache behavior
// Expected: High hit rate

#include <stdio.h>

#define N 64

int main() {
  int matrix[N][N];
  int sum = 0;

  // Row-major: sequential in memory
  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      matrix[i][j] = i + j;
    }
  }

  for (int i = 0; i < N; i++) {
    for (int j = 0; j < N; j++) {
      sum += matrix[i][j];
    }
  }

  printf("Sum: %d\n", sum);
  return 0;
}
