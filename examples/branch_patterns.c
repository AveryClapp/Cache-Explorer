// Branch prediction patterns
// Set RUN_ALTERNATING=1 to isolate alternating data branches
#include <stdio.h>

#ifndef RUN_ALTERNATING
#define RUN_ALTERNATING 0
#endif

#define N 100000

int main() {
  volatile int total = 0;

#if RUN_ALTERNATING
  for (int i = 0; i < N; i++) {
    if (i & 1) {
      total += 3;
    } else {
      total -= 1;
    }
  }
#else
  for (int i = 0; i < N; i++) {
    if (i < N - 1) {
      total += i & 7;
    }
  }
#endif

  printf("%d\n", total);
  return 0;
}
