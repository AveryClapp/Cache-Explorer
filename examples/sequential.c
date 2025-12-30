// Sequential array access - good cache behavior
// Expected: High hit rate due to spatial locality

#include <stdio.h>

#define N 1000

int main() {
  int arr[N];
  int sum = 0;

  // Sequential writes - each cache line (64 bytes = 16 ints) loaded once
  for (int i = 0; i < N; i++) {
    arr[i] = i;
  }

  // Sequential reads - should hit cache
  for (int i = 0; i < N; i++) {
    sum += arr[i];
  }

  printf("Sum: %d\n", sum);
  return 0;
}
